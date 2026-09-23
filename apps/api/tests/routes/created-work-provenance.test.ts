/**
 * Provenance of work created outside the task, project, and initiative routes.
 *
 * @remarks
 * Each case enters where production enters: the automation engine for rules, the accept route or
 * an auto-accept rule for email, the import, a sync pass, the Athena dispatcher's route, and the
 * timer. Each then reads back the change set that created the task and checks the door it names.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ImportedItem } from '@docket/integrations';
import type { TaskSynthesizer } from '@docket/work/task-drafting';
import { assertDefined } from '@docket/test-utils';

import { acceptSuggestion } from '../../src/lib/email-to-task/accept';
import { persistSuggestions, type CandidateThread } from '../../src/lib/email-to-task/synthesize';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';
import { originOf } from '../../src/mcp/change-set';
import { importItems } from '../../src/routes/integration-import';
import { reconcileTasks } from '../../src/routes/integration-reconcile';
import { runLeasedSync } from '../../src/routes/integration-sync';
import { adoptEntity } from '../../src/routes/notion-mirror-entities';
import { createTimeRecord } from '../../src/time/service';
import { dispatchAthenaWork } from '../support/entry-point-writers';
import {
  addMember,
  getDb,
  one,
  scoped,
  seedBaseOrg,
  seedUserWithHub,
  syncPass,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const synthesizer: TaskSynthesizer = {
  synthesize: async ({ subject }) => ({ title: `Follow up: ${subject}`, priority: 'none' }),
};

/** A thread that clears the task-worthiness funnel: a direct ask with a deadline. */
function askThread(threadId: string): CandidateThread {
  return {
    threadId,
    subject: 'Sponsorship slot — please confirm by Friday',
    snippet:
      'We are holding one sponsor slot. Can you confirm by Friday so we can send the agreement?',
    sender: 'partnerships@showcase.example',
    receivedAt: '2026-08-08T09:00:00.000Z',
    rfc822MessageId: `<${threadId}@showcase.example>`,
    externalUrl: `https://mail.mock.docket.local/#all/${threadId}`,
  };
}

/** A workspace with a connected mailbox, owned by one member. */
async function seedMailbox(): Promise<{ orgId: string; actorId: string; integrationId: string }> {
  const { orgId, humanActorId } = await seedBaseOrg(db, schema);
  const integrationId = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id }),
  ).id;
  return { orgId, actorId: humanActorId, integrationId };
}

/** Store one enabled rule that fires on every new email suggestion. */
async function addSuggestionRule(orgId: string, action: string): Promise<string> {
  return one(
    await db
      .insert(schema.automationRule)
      .values({
        organizationId: orgId,
        name: action,
        enabled: true,
        eventMatch: { kind: 'created', subjectType: 'email_suggestion' },
        condition: { op: 'and', nodes: [] },
        actions: [{ type: action, params: {} }],
      })
      .returning({ id: schema.automationRule.id }),
  ).id;
}

/** Ingest one thread through the mailbox sweep's seam; returns the suggestion id. */
async function ingest(mailbox: Awaited<ReturnType<typeof seedMailbox>>, threadId: string) {
  const result = await persistSuggestions({
    organizationId: mailbox.orgId,
    integrationId: mailbox.integrationId,
    threads: [askThread(threadId)],
    threshold: 40,
    actorId: mailbox.actorId,
    synthesizer,
  });
  return one(result.suggestionIds);
}

/** The one task in a workspace. */
async function onlyTask(orgId: string): Promise<typeof schema.task.$inferSelect> {
  return one(await db.select().from(schema.task).where(eq(schema.task.organizationId, orgId)));
}

describe('work a rule creates', () => {
  it('records a routed email as the routing rule’s doing, naming the rule', async () => {
    const mailbox = await seedMailbox();
    const ruleId = await addSuggestionRule(mailbox.orgId, 'task.route');

    await ingest(mailbox, 'thread_routed');

    const created = await originOf('task', (await onlyTask(mailbox.orgId)).id);
    expect(created?.actorId).toBe(mailbox.actorId);
    expect(created?.origin).toMatchObject({
      v: 2,
      channel: 'rule',
      surface: 'routing',
      performer: { kind: 'docket' },
      ref: { ruleId },
      tool: 'task_route',
    });
  });
});

describe('work accepted from email', () => {
  it('records an automatic accept on the email channel, naming the suggestion', async () => {
    const mailbox = await seedMailbox();
    await addSuggestionRule(mailbox.orgId, 'suggestion.autoAccept');

    const suggestionId = await ingest(mailbox, 'thread_auto_accepted');

    const created = await originOf('task', (await onlyTask(mailbox.orgId)).id);
    expect(created?.actorId).toBe(mailbox.actorId);
    expect(created?.origin).toMatchObject({
      channel: 'email',
      performer: { kind: 'athena' },
      ref: { messageId: suggestionId },
      tool: 'email_accept',
    });
    expect(created?.origin).not.toHaveProperty('surface');
  });

  it('records an accept from the inbox as the person, in the app', async () => {
    const mailbox = await seedMailbox();
    const suggestionId = await ingest(mailbox, 'thread_accepted_in_app');

    const result = await runWithProvenance(appProvenance('inbox'), () =>
      acceptSuggestion({
        organizationId: mailbox.orgId,
        suggestionId,
        actorId: mailbox.actorId,
        overrides: {},
      }),
    );

    expect(result.kind).toBe('accepted');
    const created = await originOf('task', (await onlyTask(mailbox.orgId)).id);
    expect(created?.origin).toMatchObject({
      channel: 'app',
      surface: 'inbox',
      performer: { kind: 'person' },
      ref: { messageId: suggestionId },
    });
  });
});

/** A remote work item as a connector returns it. */
function remoteItem(
  externalId: string,
  provider: ImportedItem['provenance']['provider'],
): ImportedItem {
  return {
    id: externalId,
    kind: 'issue',
    title: `Remote ${externalId}`,
    provenance: { provider, externalId, importedAt: '2026-06-01T00:00:00.000Z' },
  };
}

/** A connected tool in a fresh workspace. */
async function seedConnectedTool(provider: string) {
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
  const row = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider,
        pattern: 'connector',
        roles: ['work'],
        createdBy: humanActorId,
      })
      .returning(),
  );
  return { orgId, teamId, actorId: humanActorId, row };
}

describe('work a connected tool brings in', () => {
  it('records a one-time import on the import channel, named by the provider', async () => {
    const tool = await seedConnectedTool('gtasks');

    const [imported] = await importItems(
      tool.orgId,
      tool.actorId,
      tool.row,
      tool.teamId,
      [remoteItem('imp-1', 'gtasks')],
      { assigneeId: null },
    );

    const created = await originOf('task', assertDefined(imported).id);
    expect(created?.actorId).toBe(tool.actorId);
    expect(created?.origin).toMatchObject({
      channel: 'import',
      performer: { kind: 'docket', name: 'gtasks' },
      integration: { id: tool.row.id, provider: 'gtasks' },
      tool: 'integration_import',
    });
  });

  it('records what a sync pass creates on the sync channel, whoever started the pass', async () => {
    const tool = await seedConnectedTool('linear');

    const run = await runLeasedSync(
      tool.row,
      { actorId: tool.actorId, trigger: 'scheduled', purpose: 'task_sync' },
      async () => {
        const tally = await reconcileTasks(
          tool.orgId,
          tool.actorId,
          tool.row,
          tool.teamId,
          [remoteItem('sync-1', 'linear')],
          { assigneeId: null, writable: null, readChangedOnly: false },
        );
        return { processed: tally.inserted, total: 1, stampFullSync: false };
      },
    );

    expect(run?.status).toBe('succeeded');
    const created = await originOf('task', (await onlyTask(tool.orgId)).id);
    expect(created?.origin).toMatchObject({
      channel: 'sync',
      performer: { kind: 'docket', name: 'linear' },
      integration: { id: tool.row.id, provider: 'linear' },
      tool: 'sync_create',
    });
  });
});

describe('work a Notion mirror adopts', () => {
  it('records an adopted project on the sync channel, created by the mirror’s owner', async () => {
    const tool = await seedConnectedTool('notion');

    const projectId = await scoped(syncPass('notion'), adoptEntity)(
      tool.orgId,
      tool.actorId,
      tool.row,
      'project',
      { name: { kind: 'text', value: 'Adopted from Notion' } },
    );

    const created = await originOf('project', assertDefined(projectId));
    expect(created?.actorId).toBe(tool.actorId);
    expect(created?.origin).toMatchObject({ channel: 'sync', tool: 'sync_create' });
    const [row] = await db
      .select({ createdBy: schema.project.createdBy })
      .from(schema.project)
      .where(eq(schema.project.id, assertDefined(projectId)));
    expect(row?.createdBy).toBe(tool.actorId);
  });
});

describe('work a person creates through Athena and the timer', () => {
  it('records dispatched Athena work under the app request that dispatched it', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const ownerUserId = await seedUserWithHub(db, schema, 'Dispatcher');
    const initiatorActorId = await addMember(db, schema, orgId, ownerUserId, 'owner');

    const dispatched = await dispatchAthenaWork({
      ownerUserId,
      prompt: 'Draft the launch checklist',
      organizationId: orgId,
      initiatorActorId,
    });

    const created = await originOf('task', assertDefined(dispatched.taskId));
    expect(created?.actorId).toBe(initiatorActorId);
    expect(created?.origin).toMatchObject({ channel: 'app', tool: 'athena_dispatch' });
  });

  it('records the task a named timer creates under the caller’s provenance', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'Tracker');
    const actorId = await addMember(db, schema, orgId, userId, 'owner');
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });

    const record = await runWithProvenance(appProvenance(), () =>
      createTimeRecord(userId, {
        context: { label: 'Review the contract', organizationId: orgId, contextualRefs: [] },
      }),
    );

    const created = await originOf('task', assertDefined(record.taskId));
    expect(created?.actorId).toBe(actorId);
    expect(created?.origin).toMatchObject({ channel: 'app', tool: 'time_anchor' });
  });
});
