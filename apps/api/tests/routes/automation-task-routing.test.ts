/**
 * `task.route` — inbound stream items becoming routed, provenance-stamped tasks.
 *
 * @remarks
 * These run the real seams, not stand-ins for them. The mail cases enter at
 * {@link persistSuggestions} (the exact function the scheduled mailbox sweep calls once it has a
 * page of threads) and travel the production path from there: funnel → suggestion row → the real
 * `emitEvent` facade → the automation engine → the default handler registry. Most webhook cases
 * enter at {@link projectInboundDraft}, the pure projection the webhook drain feeds the engine;
 * the identity case enters a step earlier still, at {@link sweepInboundEvents} with a real
 * provider payload, because which identity the drain *derives* for that projection is itself the
 * thing under test. Everything downstream of those entry points is the code that runs in
 * production.
 *
 * The four properties under test are the ones that decide whether an automation like this is
 * usable: it routes to the right workspace, it links rather than duplicates, it is idempotent,
 * and it does nothing at all when no rule matches.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { TaskSynthesizer } from '@docket/agent-runtime';
import { RealGitHubObserver } from '@docket/integrations';

import { addMember, getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';
import * as container from '../../src/container';
import { sweepInboundEvents } from '../../src/routes/event-sync';
import { projectEmitInput, projectInboundDraft } from '../../src/lib/automation/event';
import { routeInboundItemToTask } from '../../src/lib/automation/route-task';
import { runAutomationsForEvent } from '../../src/lib/automation/runtime';
import { acceptSuggestion } from '../../src/lib/email-to-task/accept';
import { persistSuggestions, type CandidateThread } from '../../src/lib/email-to-task/synthesize';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/**
 * A deterministic synthesizer: the offline stand-in for Athena's drafting step.
 *
 * @remarks
 * Substituting it keeps these tests about routing rather than about draft quality — the fields
 * it returns are the ones routing carries onto the task, so they need to be predictable, not
 * clever. This is the same substitution the sweep makes in `local`/`test` mode.
 */
const synthesizer: TaskSynthesizer = {
  synthesize: async ({ subject }) => ({ title: `Follow up: ${subject}`, priority: 'none' }),
};

/** The LVBT-opportunity fixture: a real ask, from a real person, with a real deadline. */
const LVBT_THREAD: CandidateThread = {
  threadId: 'thread_lvbt_sponsorship',
  subject: 'LVBT sponsorship slot — please confirm by Friday',
  snippet:
    'We are holding one sponsor slot for LVBT at the spring showcase. Can you confirm by Friday so we can send the agreement?',
  sender: 'partnerships@showcase.example',
  receivedAt: '2026-08-08T09:00:00.000Z',
  rfc822MessageId: '<lvbt-sponsorship-2026@showcase.example>',
  externalUrl: 'https://mail.mock.docket.local/#all/thread_lvbt_sponsorship',
};

/** A thread that is plainly not an LVBT matter — the negative case for rule matching. */
const UNRELATED_THREAD: CandidateThread = {
  threadId: 'thread_dentist',
  subject: 'Your appointment — please confirm the time',
  snippet: 'Can you confirm Tuesday at 3pm works for your cleaning?',
  sender: 'front-desk@dentist.example',
  receivedAt: '2026-08-08T09:05:00.000Z',
  rfc822MessageId: '<dentist-2026@dentist.example>',
  externalUrl: 'https://mail.mock.docket.local/#all/thread_dentist',
};

/**
 * Two workspaces and one person who belongs to both: a personal workspace where the mailbox is
 * connected, and the LVBT workspace where LVBT work belongs.
 *
 * @remarks
 * This split is the whole point of routing. Nothing about the mail says which workspace it is
 * for; the rule does, and it names a workspace other than the one the mail arrived in.
 */
async function seedTwoWorkspaces() {
  const personal = await seedBaseOrg(db, schema);
  const lvbt = await seedBaseOrg(db, schema);
  const userId = await seedUserWithHub(db, schema, 'Willie');
  // The mailbox owner, as an actor in each workspace. Routing carries the person across, not
  // the actor id — an actor id is workspace-scoped.
  const personalActorId = await addMember(db, schema, personal.orgId, userId, 'owner');
  const lvbtActorId = await addMember(db, schema, lvbt.orgId, userId, 'owner');
  const integrationId = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: personal.orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        createdBy: personalActorId,
      })
      .returning({ id: schema.integration.id }),
  ).id;
  return {
    userId,
    personalOrgId: personal.orgId,
    personalActorId,
    personalStatusId: personal.statusId,
    lvbtOrgId: lvbt.orgId,
    lvbtTeamId: lvbt.teamId,
    lvbtActorId,
    lvbtStatusId: lvbt.statusId,
    integrationId,
  };
}

/**
 * A second connected mailbox, in its own workspace, belonging to the same person.
 *
 * @remarks
 * The situation the routing key was chosen for: one email reaching two mailboxes carries one
 * RFC 5322 Message-ID under two provider thread ids, so it becomes two `email_suggestion` rows
 * (each workspace's funnel dedupes only against its own) that route to a single ledger key.
 */
async function seedSecondMailbox(userId: string) {
  const org = await seedBaseOrg(db, schema);
  const actorId = await addMember(db, schema, org.orgId, userId, 'owner');
  const integrationId = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: org.orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        createdBy: actorId,
      })
      .returning({ id: schema.integration.id }),
  ).id;
  return { orgId: org.orgId, actorId, integrationId };
}

/** Store a rule as the data it is: an `automation_rule` row, exactly as the API writes one. */
async function addRule(
  orgId: string,
  on: unknown,
  when: unknown,
  then: unknown,
  name = 'test rule',
): Promise<string> {
  return one(
    await db
      .insert(schema.automationRule)
      .values({
        organizationId: orgId,
        name,
        enabled: true,
        eventMatch: on,
        condition: when,
        actions: then,
      })
      .returning({ id: schema.automationRule.id }),
  ).id;
}

/**
 * The rule the headline case needs: mail whose subject mentions LVBT is LVBT's work, and belongs
 * in the LVBT workspace at high priority.
 */
function lvbtRoutingRule(lvbtOrgId: string, extraParams: Record<string, unknown> = {}) {
  return {
    on: { kind: 'created', subjectType: 'email_suggestion' },
    when: { op: 'contains', path: 'detail.subject', value: 'LVBT' },
    then: [
      {
        type: 'task.route',
        params: { organizationId: lvbtOrgId, priority: 'high', ...extraParams },
      },
    ],
  };
}

/** Run a page of threads through the production ingest seam, as one mailbox sweep would. */
async function sweep(
  organizationId: string,
  integrationId: string,
  actorId: string,
  threads: readonly CandidateThread[],
) {
  return persistSuggestions({
    organizationId,
    integrationId,
    threads,
    threshold: 40,
    actorId,
    synthesizer,
  });
}

/** Every task in a workspace, oldest first. */
async function tasksIn(orgId: string) {
  return db.select().from(schema.task).where(eq(schema.task.organizationId, orgId));
}

/** Every routing-ledger row in a workspace. */
async function routesIn(orgId: string) {
  return db
    .select()
    .from(schema.inboundTaskRoute)
    .where(eq(schema.inboundTaskRoute.organizationId, orgId));
}

describe('an email matching a rule becomes a task in the workspace the rule names', () => {
  it('routes an LVBT opportunity into the LVBT workspace, stamped with the source message', async () => {
    const w = await seedTwoWorkspaces();
    const rule = lvbtRoutingRule(w.lvbtOrgId);
    await addRule(w.personalOrgId, rule.on, rule.when, rule.then, 'LVBT opportunities → LVBT');

    const result = await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [LVBT_THREAD]);
    expect(result.created).toBe(1);

    // The task landed in LVBT — not in the workspace the mailbox is connected to.
    const lvbtTasks = await tasksIn(w.lvbtOrgId);
    expect(lvbtTasks).toHaveLength(1);
    expect(await tasksIn(w.personalOrgId)).toHaveLength(0);

    const task = one(lvbtTasks);
    expect(task.title).toBe(`Follow up: ${LVBT_THREAD.subject}`);
    expect(task.priority).toBe('high');
    // Written under this person's LVBT actor, never their personal-workspace one.
    expect(task.createdBy).toBe(w.lvbtActorId);
    expect(task.teamId).toBe(w.lvbtTeamId);

    // Provenance: the routing ledger identifies the source message by its RFC 5322 Message-ID,
    // which is the identity of the mail itself rather than of one mailbox's copy of it.
    const routes = await routesIn(w.lvbtOrgId);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      taskId: task.id,
      sourceSystem: 'gmail',
      sourceKey: '<lvbt-sponsorship-2026@showcase.example>',
      sourceUrl: LVBT_THREAD.externalUrl,
      sourceIntegrationId: w.integrationId,
      originOrganizationId: w.personalOrgId,
    });

    // Provenance a person can click: the thread rides along as an email attachment on the task.
    const attachments = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.subjectId, task.id));
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      kind: 'email',
      url: LVBT_THREAD.externalUrl,
      externalId: '<lvbt-sponsorship-2026@showcase.example>',
      sourceIntegrationId: w.integrationId,
    });

    // The suggestion is closed out, so the review queue does not also ask a person to accept
    // something that already became a task.
    const suggestion = one(
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.externalThreadId, LVBT_THREAD.threadId)),
    );
    expect(suggestion.status).toBe('accepted');
    expect(suggestion.createdTaskId).toBe(task.id);
  });

  it('files the routed task into the project a rule names, which is what an Athena assignment watches', async () => {
    const w = await seedTwoWorkspaces();
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: w.lvbtOrgId,
          teamId: w.lvbtTeamId,
          name: 'LVBT Partnerships',
          createdBy: w.lvbtActorId,
          status: 'planned',
          statusId: w.lvbtStatusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    ).id;
    const rule = lvbtRoutingRule(w.lvbtOrgId, { projectId });
    await addRule(w.personalOrgId, rule.on, rule.when, rule.then);

    // The assignment-trigger hook observes the same committed event the routed task emits. Spying
    // on it proves routing hands the trigger machinery the right workspace and the right subject;
    // the machinery's own behaviour is covered by the assignment suite.
    const assignments = await import('../../src/agent/assignments');
    const observed = vi.spyOn(assignments, 'handleAthenaAssignmentEvent');

    await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [LVBT_THREAD]);

    const task = one(await tasksIn(w.lvbtOrgId));
    expect(task.projectId).toBe(projectId);
    expect(observed).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: w.lvbtOrgId,
        kind: 'created',
        subject: expect.objectContaining({ type: 'task', id: task.id }),
      }),
      expect.anything(),
    );
    observed.mockRestore();
  });

  it('refuses to route into a workspace the mailbox owner does not belong to', async () => {
    const w = await seedTwoWorkspaces();
    const stranger = await seedBaseOrg(db, schema); // nobody from the mailbox is a member here
    const rule = lvbtRoutingRule(stranger.orgId);
    await addRule(w.personalOrgId, rule.on, rule.when, rule.then);

    await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [LVBT_THREAD]);

    expect(await tasksIn(stranger.orgId)).toHaveLength(0);
    expect(await routesIn(stranger.orgId)).toHaveLength(0);
    // And it did not silently fall back to creating the task somewhere the rule did not name.
    expect(await tasksIn(w.personalOrgId)).toHaveLength(0);
    expect(await tasksIn(w.lvbtOrgId)).toHaveLength(0);
  });
});

describe('no rule matches means nothing is created', () => {
  it('leaves the suggestion pending and creates no task in any workspace', async () => {
    const w = await seedTwoWorkspaces();
    const rule = lvbtRoutingRule(w.lvbtOrgId);
    await addRule(w.personalOrgId, rule.on, rule.when, rule.then);

    // The rule is enabled and its `on` clause matches the event; only its condition fails.
    // Over-creation would look exactly like success here, which is why this is asserted on both
    // workspaces and on the ledger rather than on a return value.
    const result = await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [
      UNRELATED_THREAD,
    ]);
    expect(result.created).toBe(1); // a suggestion, which is all a non-matching item may become

    expect(await tasksIn(w.lvbtOrgId)).toHaveLength(0);
    expect(await tasksIn(w.personalOrgId)).toHaveLength(0);
    expect(await routesIn(w.lvbtOrgId)).toHaveLength(0);

    const suggestion = one(
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.externalThreadId, UNRELATED_THREAD.threadId)),
    );
    expect(suggestion.status).toBe('pending');
    expect(suggestion.createdTaskId).toBeNull();
  });

  it('creates nothing when the workspace has no rules at all', async () => {
    const w = await seedTwoWorkspaces();
    await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [LVBT_THREAD]);
    expect(await tasksIn(w.lvbtOrgId)).toHaveLength(0);
    expect(await tasksIn(w.personalOrgId)).toHaveLength(0);
  });
});

describe('the same inbound item processed twice produces one task', () => {
  it('re-listing the same email in a later sweep does not open a second task', async () => {
    const w = await seedTwoWorkspaces();
    const rule = lvbtRoutingRule(w.lvbtOrgId);
    await addRule(w.personalOrgId, rule.on, rule.when, rule.then);

    // Sweeps overlap by design — the mail cursor resumes from the last run and re-lists recent
    // threads. The second pass here is that overlap, not a synthetic replay.
    await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [LVBT_THREAD]);
    const second = await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [LVBT_THREAD]);
    expect(second.created).toBe(0);
    expect(second.skippedExisting).toBe(1);

    expect(await tasksIn(w.lvbtOrgId)).toHaveLength(1);
    expect(await routesIn(w.lvbtOrgId)).toHaveLength(1);
  });

  it('a redelivered webhook resolves to the task the first delivery created', async () => {
    const w = await seedTwoWorkspaces();
    await addRule(
      w.personalOrgId,
      { kind: 'created', source: 'github' },
      { op: 'and', nodes: [] },
      [{ type: 'task.route', params: {} }],
    );

    // The same pull request, delivered twice. Webhook redelivery is routine — GitHub retries on
    // any non-2xx, and the drain re-runs a lease that went stale.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runAutomationsForEvent(
        projectInboundDraft({
          organizationId: w.personalOrgId,
          kind: 'created',
          source: 'github',
          entityKind: 'work_item',
          docketEntityId: null,
          externalId: 'pr_9001',
          externalUrl: 'https://github.com/lvbt/site/pull/12',
          title: 'Opened PR: Fix the booking form',
          detail: { schema: 'github.pull_request', number: 12, merged: false, draft: false },
          occurredAt: new Date('2026-08-08T10:00:00.000Z'),
        }),
      );
    }

    expect(await tasksIn(w.personalOrgId)).toHaveLength(1);
    const routes = await routesIn(w.personalOrgId);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ sourceSystem: 'github', sourceKey: 'pr_9001' });
  });
});

describe('a later event about the same item updates the linked task', () => {
  it('a PR close moves the task the PR open created, rather than filing a second one', async () => {
    const w = await seedTwoWorkspaces();
    await addRule(
      w.personalOrgId,
      { kind: 'created', source: 'github' },
      { op: 'and', nodes: [] },
      [{ type: 'task.route', params: {} }],
      'open a PR → open a task',
    );
    await addRule(
      w.personalOrgId,
      { kind: 'completed', source: 'github' },
      { op: 'and', nodes: [] },
      [{ type: 'task.route', params: { state: 'done' } }],
      'close a PR → close its task',
    );

    /** One GitHub delivery about pull request 12, at the given lifecycle point. */
    const delivery = (kind: 'created' | 'completed', title: string, merged: boolean) =>
      runAutomationsForEvent(
        projectInboundDraft({
          organizationId: w.personalOrgId,
          kind,
          source: 'github',
          entityKind: 'work_item',
          docketEntityId: null,
          // The two deliveries carry different `dedupeKey`s upstream and the SAME entity id.
          // That id is what links them; keying on the delivery would duplicate here.
          externalId: 'pr_9001',
          externalUrl: 'https://github.com/lvbt/site/pull/12',
          title,
          detail: { schema: 'github.pull_request', number: 12, merged, draft: false },
          occurredAt: new Date('2026-08-08T10:00:00.000Z'),
        }),
      );

    await delivery('created', 'Opened PR: Fix the booking form', false);
    const afterOpen = await tasksIn(w.personalOrgId);
    expect(afterOpen).toHaveLength(1);
    const openedTaskId = one(afterOpen).id;
    expect(one(afterOpen).state).not.toBe('done');

    await delivery('completed', 'Merged PR: Fix the booking form', true);

    const afterClose = await tasksIn(w.personalOrgId);
    expect(afterClose).toHaveLength(1);
    expect(one(afterClose).id).toBe(openedTaskId); // the same task, moved
    expect(one(afterClose).state).toBe('done');
    expect(await routesIn(w.personalOrgId)).toHaveLength(1);
  });

  it('updates the task ingestion already mirrored the item onto, instead of a parallel copy', async () => {
    const w = await seedTwoWorkspaces();
    // A task the connector already mirrors from this Linear issue — the association the drain
    // resolves and hands the engine as the event's Docket subject.
    const mirrored = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: w.personalOrgId,
          teamId: (await seedTeamlessLookup(w.personalOrgId)).teamId,
          title: 'Mirrored: Ship the booking form',
          state: 'todo',
          statusId: w.personalStatusId('task', 'todo'),
          createdBy: w.personalActorId,
        })
        .returning(),
    );
    await addRule(
      w.personalOrgId,
      { kind: 'completed', source: 'linear' },
      { op: 'and', nodes: [] },
      [{ type: 'task.route', params: { state: 'done' } }],
    );

    await runAutomationsForEvent(
      projectInboundDraft({
        organizationId: w.personalOrgId,
        kind: 'completed',
        source: 'linear',
        entityKind: 'work_item',
        docketEntityId: mirrored.id, // reverse-maps to subjectType `task`
        externalId: 'lin_issue_77',
        externalUrl: 'https://linear.app/lvbt/issue/LVB-77',
        title: 'Completed issue: Ship the booking form',
        detail: null,
        occurredAt: new Date('2026-08-08T11:00:00.000Z'),
      }),
    );

    const tasks = await tasksIn(w.personalOrgId);
    expect(tasks).toHaveLength(1); // no parallel copy alongside the mirror
    expect(one(tasks).id).toBe(mirrored.id);
    expect(one(tasks).state).toBe('done');
    // And the ledger now points at the mirror, so a later delivery short-circuits on it.
    expect(one(await routesIn(w.personalOrgId))).toMatchObject({
      taskId: mirrored.id,
      sourceSystem: 'linear',
      sourceKey: 'lin_issue_77',
    });
  });
});

/** The workspace's landing team — the same team the routing resolver would pick. */
async function seedTeamlessLookup(orgId: string): Promise<{ teamId: string }> {
  const row = one(
    await db
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(eq(schema.team.organizationId, orgId))
      .limit(1),
  );
  return { teamId: row.id };
}

describe('routing declines rather than guesses', () => {
  it('does nothing for an external item that carries no stable identity', async () => {
    const w = await seedTwoWorkspaces();
    await addRule(
      w.personalOrgId,
      { kind: 'created', source: 'github' },
      { op: 'and', nodes: [] },
      [{ type: 'task.route', params: {} }],
    );

    await runAutomationsForEvent(
      projectInboundDraft({
        organizationId: w.personalOrgId,
        kind: 'created',
        source: 'github',
        entityKind: null,
        docketEntityId: null,
        externalId: null, // nothing to dedupe or link on
        externalUrl: null,
        title: 'Something happened',
        detail: null,
        occurredAt: new Date('2026-08-08T12:00:00.000Z'),
      }),
    );

    expect(await tasksIn(w.personalOrgId)).toHaveLength(0);
    expect(await routesIn(w.personalOrgId)).toHaveLength(0);
  });

  it('does nothing for an internal Docket event, which is not an inbound item', async () => {
    const w = await seedTwoWorkspaces();
    await addRule(
      w.personalOrgId,
      { kind: 'created', subjectType: 'project' },
      { op: 'and', nodes: [] },
      [{ type: 'task.route', params: {} }],
    );

    await runAutomationsForEvent({
      organizationId: w.personalOrgId,
      kind: 'created',
      source: 'docket',
      subjectType: 'project',
      subjectId: 'proj_whatever',
      detail: {},
      occurredAt: new Date('2026-08-08T12:00:00.000Z'),
    });

    expect(await tasksIn(w.personalOrgId)).toHaveLength(0);
  });

  it('ignores a project belonging to another workspace rather than writing it onto the task', async () => {
    const w = await seedTwoWorkspaces();
    const foreign = await seedBaseOrg(db, schema);
    const foreignProjectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: foreign.orgId,
          teamId: foreign.teamId,
          name: 'Someone else’s project',
          createdBy: foreign.humanActorId,
          status: 'planned',
          statusId: foreign.statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    ).id;
    const rule = lvbtRoutingRule(w.lvbtOrgId, { projectId: foreignProjectId });
    await addRule(w.personalOrgId, rule.on, rule.when, rule.then);

    await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [LVBT_THREAD]);

    const task = one(await tasksIn(w.lvbtOrgId));
    expect(task.projectId).toBeNull(); // routed, but not into a workspace it cannot see
  });
});

/**
 * Every task in a workspace with no routing-ledger row pointing at it.
 *
 * @remarks
 * The orphan detector. A task in this set is one the ledger cannot see, so the next delivery of
 * the same item creates another one beside it — and it reached the workspace without the
 * `created` event or search-index entry the create path emits. Zero is the only acceptable
 * count, and asserting on it is stronger than counting tasks, because a leaked task and a
 * correctly adopted one are both "one extra row" until you ask which of them the ledger knows.
 */
async function orphanTasksIn(orgId: string) {
  return db
    .select({ id: schema.task.id, title: schema.task.title })
    .from(schema.task)
    .leftJoin(schema.inboundTaskRoute, eq(schema.inboundTaskRoute.taskId, schema.task.id))
    .where(and(eq(schema.task.organizationId, orgId), isNull(schema.inboundTaskRoute.id)));
}

/** One suggestion's `created` event, projected exactly as the emit facade projects one. */
function mailDelivery(organizationId: string, actorId: string, suggestionId: string) {
  return projectEmitInput(
    {
      organizationId,
      kind: 'created',
      actorId,
      title: LVBT_THREAD.subject,
      subject: { type: 'email_suggestion', id: suggestionId, title: LVBT_THREAD.subject },
    },
    new Date('2026-08-08T09:00:00.000Z'),
  );
}

/** One GitHub pull-request delivery, projected exactly as the webhook drain projects one. */
function prDelivery(organizationId: string, externalId: string) {
  return projectInboundDraft({
    organizationId,
    kind: 'created',
    source: 'github',
    entityKind: 'work_item',
    docketEntityId: null,
    externalId,
    externalUrl: 'https://github.com/lvbt/site/pull/12',
    title: 'Opened PR: Fix the booking form',
    detail: { schema: 'github.pull_request', number: 12, merged: false, draft: false },
    occurredAt: new Date('2026-08-08T10:00:00.000Z'),
  });
}

describe('two deliveries of one item racing each other still produce exactly one task', () => {
  it('rolls the loser back instead of committing a task the ledger cannot see', async () => {
    const w = await seedTwoWorkspaces();
    const event = prDelivery(w.personalOrgId, 'pr_raced_9001');

    // Both deliveries read the ledger, both find nothing, and both go on to create. This is a
    // redelivered webhook, or two rules that both name `task.route` for one email — not a
    // synthetic scenario. Only one of them can win the unique index on
    // (organizationId, sourceSystem, sourceKey); the question is what happens to the other's
    // half-finished work.
    const [first, second] = await Promise.all([
      routeInboundItemToTask(event, {}),
      routeInboundItemToTask(event, {}),
    ]);

    // The headline invariant, asserted first: the loser's task insert was rolled back rather
    // than committed. Before the sentinel throw, a normal return from the transaction callback
    // committed it, leaving a real task in the workspace with no ledger row, no `created` event
    // and no search entry.
    expect(await orphanTasksIn(w.personalOrgId)).toHaveLength(0);

    // Exactly one task, and exactly one ledger row naming it.
    const tasks = await tasksIn(w.personalOrgId);
    expect(tasks).toHaveLength(1);
    const routes = await routesIn(w.personalOrgId);
    expect(routes).toHaveLength(1);
    expect(one(routes).taskId).toBe(one(tasks).id);

    // And the loser adopted the winner's task rather than reporting a second creation.
    const outcomes = [first, second];
    expect(outcomes.filter((o) => o.kind === 'created')).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'updated')).toHaveLength(1);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ taskId: one(tasks).id });
    }
  });

  it('closes the losing delivery’s suggestion, so accepting it later opens nothing', async () => {
    const w = await seedTwoWorkspaces();
    const mailboxB = await seedSecondMailbox(w.userId);

    // One message, two connected mailboxes. The provider thread ids differ and each workspace's
    // funnel dedupe only ever looks at its own rows, so this is two `email_suggestion` rows for
    // one email — and both carry the same RFC 5322 Message-ID, which is the key routing dedupes
    // on. Two suggestions, one routing key, one target workspace.
    const viaMailboxB: CandidateThread = { ...LVBT_THREAD, threadId: 'thread_lvbt_sponsorship_b' };
    const fromA = one(
      (await sweep(w.personalOrgId, w.integrationId, w.personalActorId, [LVBT_THREAD]))
        .suggestionIds,
    );
    const fromB = one(
      (await sweep(mailboxB.orgId, mailboxB.integrationId, mailboxB.actorId, [viaMailboxB]))
        .suggestionIds,
    );

    const [outcomeA, outcomeB] = await Promise.all([
      routeInboundItemToTask(mailDelivery(w.personalOrgId, w.personalActorId, fromA), {
        organizationId: w.lvbtOrgId,
      }),
      routeInboundItemToTask(mailDelivery(mailboxB.orgId, mailboxB.actorId, fromB), {
        organizationId: w.lvbtOrgId,
      }),
    ]);

    // One task, as ever — and one of the two deliveries lost the ledger race and adopted it.
    const routedTaskId = one(await tasksIn(w.lvbtOrgId)).id;
    expect(await orphanTasksIn(w.lvbtOrgId)).toHaveLength(0);
    expect([outcomeA, outcomeB].filter((o) => o.kind === 'created')).toHaveLength(1);

    // The point of this case: BOTH suggestions record the task that exists. Leaving the loser's
    // row pending would leave the review queue holding an email that already became a task, and
    // accepting it — by hand or by a `suggestion.autoAccept` rule — would make the second task
    // this whole module exists to prevent, because `acceptSuggestion` reads the suggestion's
    // status and never the routing ledger.
    const loser =
      outcomeA.kind === 'created'
        ? { orgId: mailboxB.orgId, actorId: mailboxB.actorId, suggestionId: fromB }
        : { orgId: w.personalOrgId, actorId: w.personalActorId, suggestionId: fromA };
    for (const [orgId, suggestionId] of [
      [w.personalOrgId, fromA],
      [mailboxB.orgId, fromB],
    ] as const) {
      const row = one(
        await db
          .select()
          .from(schema.emailSuggestion)
          .where(
            and(
              eq(schema.emailSuggestion.id, suggestionId),
              eq(schema.emailSuggestion.organizationId, orgId),
            ),
          ),
      );
      expect(row.status).toBe('accepted');
      expect(row.createdTaskId).toBe(routedTaskId);
    }

    // And the accept itself, run against the loser's row exactly as the review queue or an
    // autoAccept rule would run it: it finds nothing left to do, and no second task appears.
    const accepted = await acceptSuggestion({
      organizationId: loser.orgId,
      suggestionId: loser.suggestionId,
      actorId: loser.actorId,
      overrides: {},
    });
    expect(accepted.kind).toBe('already_resolved');
    expect(await tasksIn(loser.orgId)).toHaveLength(0);
    expect(await tasksIn(w.lvbtOrgId)).toHaveLength(1);
  });

  it('lets a genuine database error surface instead of reading it as a lost race', async () => {
    const w = await seedTwoWorkspaces();
    const event = prDelivery(w.personalOrgId, 'pr_broken_9002');

    // A rule naming a team that does not exist. The task insert violates its `team_id` foreign
    // key inside the transaction — a real write failure, not a race. Catching the race by a
    // broad `catch` rather than by its own type would swallow this and hand the caller a
    // confident `updated`/`skipped` for a task that was never written.
    const error = await routeInboundItemToTask(event, { teamId: 'tem_does_not_exist' }).then(
      (outcome) => {
        throw new Error(`expected a database error, but routing reported ${outcome.kind}`);
      },
      (err: unknown) => err,
    );
    // Drizzle wraps the driver's error, so the failing statement is the message and the
    // constraint violation itself is the cause. Both say the same thing: this is a write that
    // failed, and it reached the caller rather than being absorbed as a race.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Failed query: insert into "task"/);
    expect(String((error as { cause?: unknown }).cause)).toMatch(/foreign key/i);

    // Nothing was left behind, and nothing was quietly reported as routed.
    expect(await tasksIn(w.personalOrgId)).toHaveLength(0);
    expect(await routesIn(w.personalOrgId)).toHaveLength(0);
    expect(await orphanTasksIn(w.personalOrgId)).toHaveLength(0);
  });
});

/**
 * The GitHub delivery that separates the two identities: a review comment on pull request 12.
 *
 * @remarks
 * Every other webhook shape hides the distinction, because the delivery's own object *is* the
 * entity — a `pull_request` event's id and the pull request's id are the same string. A comment
 * is the case where they diverge: the delivery is the comment (its own id, its own anchor URL),
 * the entity it concerns is the pull request. Which of the two the drain hands the engine decides
 * whether a comment and a later close land on one task or on two.
 */
const PR_REVIEW_COMMENT = {
  action: 'created',
  installation: { id: 4242 },
  comment: {
    id: 5501,
    body: 'Can we confirm the booking copy before this ships?',
    html_url: 'https://github.com/lvbt/site/pull/12#discussion_r5501',
    updated_at: '2026-08-08T10:05:00Z',
    user: { login: 'ada' },
  },
  pull_request: {
    id: 9101,
    number: 12,
    title: 'Fix the booking form',
    state: 'open',
    html_url: 'https://github.com/lvbt/site/pull/12',
    updated_at: '2026-08-08T10:00:00Z',
  },
} as const;

/** The same pull request, closed — the second delivery that must find the first one's task. */
const PR_CLOSED = {
  action: 'closed',
  installation: { id: 4242 },
  pull_request: {
    id: 9101,
    number: 12,
    title: 'Fix the booking form',
    state: 'closed',
    merged: true,
    html_url: 'https://github.com/lvbt/site/pull/12',
    updated_at: '2026-08-08T11:00:00Z',
  },
} as const;

describe('the drain hands routing the entity’s identity, not the delivery’s', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Queue one GitHub delivery for the drain, exactly as the webhook receiver records one. */
  async function queueDelivery(
    orgId: string,
    integrationId: string,
    externalEventId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await db.insert(schema.inboundEvent).values({
      organizationId: orgId,
      integrationId,
      provider: 'github',
      externalEventId,
      eventType,
      payload,
      signatureVerified: true,
    });
  }

  it('routes a review comment by the pull request’s id and URL, not the comment’s', async () => {
    const org = await seedBaseOrg(db, schema);
    const integrationId = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: org.orgId,
          provider: 'github',
          pattern: 'connector',
          roles: ['signal'],
          status: 'connected',
          connection: { externalWorkspaceId: '4242' },
          createdBy: org.humanActorId,
        })
        .returning({ id: schema.integration.id }),
    ).id;
    await addRule(
      org.orgId,
      { kind: 'comment', source: 'github' },
      { op: 'and', nodes: [] },
      [{ type: 'task.route', params: {} }],
      'GitHub activity → a task',
    );
    await addRule(
      org.orgId,
      { kind: 'completed', source: 'github' },
      { op: 'and', nodes: [] },
      [{ type: 'task.route', params: { state: 'done' } }],
      'a closed PR → its task is done',
    );

    // The real GitHub observer, on a real GitHub payload. `APP_MODE=test` otherwise selects the
    // mock, whose drafts carry neither a delivery id nor a permalink — which is exactly why the
    // derivation under test has been invisible to every routing test so far.
    vi.spyOn(container, 'buildObserver').mockReturnValue(
      new RealGitHubObserver({ signingSecret: 'test-secret' }),
    );

    await queueDelivery(
      org.orgId,
      integrationId,
      'gh_comment_5501',
      'pull_request_review_comment',
      PR_REVIEW_COMMENT,
    );
    await sweepInboundEvents(new Date('2026-08-08T10:06:00.000Z'));

    // The canonical event row records the delivery: the comment's own id and its anchor URL.
    // This is the control — it proves the two identities really are different strings here, so
    // the ledger assertions below are a choice the drain made and not a coincidence.
    const commentEvent = one(
      await db
        .select()
        .from(schema.event)
        .where(
          and(eq(schema.event.organizationId, org.orgId), eq(schema.event.sourceSystem, 'github')),
        ),
    );
    expect(commentEvent).toMatchObject({
      kind: 'comment',
      externalId: '5501',
      permalink: PR_REVIEW_COMMENT.comment.html_url,
    });

    // Routing, though, was handed the pull request — its id and its URL, not the comment's.
    const routedTaskId = one(await tasksIn(org.orgId)).id;
    expect(one(await routesIn(org.orgId))).toMatchObject({
      taskId: routedTaskId,
      sourceSystem: 'github',
      sourceKey: '9101',
      sourceUrl: PR_CLOSED.pull_request.html_url,
    });

    // And that is what the preference is for: the close arrives as a different delivery, with a
    // different id and a different dedupe key, and lands on the task the comment opened. Keying
    // on the delivery would have filed a second task here.
    await queueDelivery(org.orgId, integrationId, 'gh_pr_closed_9101', 'pull_request', PR_CLOSED);
    await sweepInboundEvents(new Date('2026-08-08T11:01:00.000Z'));

    expect(await tasksIn(org.orgId)).toHaveLength(1);
    expect(await routesIn(org.orgId)).toHaveLength(1);
    expect(one(await tasksIn(org.orgId))).toMatchObject({ id: routedTaskId, state: 'done' });
  });
});

describe('the stored rule is data the API round-trips', () => {
  it('loads a routing rule out of the table in the shape the engine dispatches', async () => {
    const w = await seedTwoWorkspaces();
    const rule = lvbtRoutingRule(w.lvbtOrgId);
    const ruleId = await addRule(w.personalOrgId, rule.on, rule.when, rule.then, 'LVBT → LVBT');

    const stored = one(
      await db
        .select()
        .from(schema.automationRule)
        .where(
          and(
            eq(schema.automationRule.id, ruleId),
            eq(schema.automationRule.organizationId, w.personalOrgId),
          ),
        ),
    );
    // The rule is rows, not a code branch: a person can read it, edit the target workspace, or
    // switch the condition without a deploy.
    expect(stored.eventMatch).toEqual({ kind: 'created', subjectType: 'email_suggestion' });
    expect(stored.condition).toEqual({ op: 'contains', path: 'detail.subject', value: 'LVBT' });
    expect(stored.actions).toEqual([
      { type: 'task.route', params: { organizationId: w.lvbtOrgId, priority: 'high' } },
    ]);
  });
});
