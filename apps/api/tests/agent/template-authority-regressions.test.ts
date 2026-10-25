/** Approval and Undo races use real persisted state and isolated in-memory SQL transactions. */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Toolbox } from '../../src/agent/toolbox';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { grantDocketPro } from '../support/routes-harness';
import {
  galleryUndoState,
  installTemplateGallery,
  templateGalleryFixture,
} from '../support/template-gallery-fixtures';
import * as serializable from '../../src/lib/serializable-tx';

let schema: typeof DbModule;
const opened: Toolbox[] = [];
beforeAll(async () => {
  schema = await getMigratedDb();
});
afterEach(async () => {
  vi.restoreAllMocks();
  while (opened.length) await opened.pop()?.close();
});

async function executor(orgId: string, userId: string) {
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: userId,
      contextOrganizationId: orgId,
      trigger: 'delegation',
      status: 'running',
    })
    .returning();
  if (!session) throw new Error('Missing session');
  const { openToolbox } = await import('../../src/agent/toolbox');
  const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId }, session.id);
  opened.push(toolbox);
  return { session, toolbox };
}
async function fixture() {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (f.ctx.principal.kind !== 'user') throw new Error('Missing human');
  const userId = f.ctx.principal.userId;
  await schema.db.insert(schema.hub).values({
    userId,
    preferences: { athena: { approvalMode: 'routine_autonomy' } },
  });
  return { ...f, userId, ...(await executor(f.orgId, userId)) };
}
async function approved(
  f: { orgId: string; actorId: string; session: { id: string } },
  tool: string,
  input: Record<string, unknown>,
) {
  const [activity] = await schema.db
    .insert(schema.sessionActivity)
    .values({
      sessionId: f.session.id,
      organizationId: f.orgId,
      type: 'action',
      approvalStatus: 'executing',
      body: {
        action: {
          kind: tool,
          summary: 'Reviewed exact action',
          mode: 'proposal',
          toolCall: { connection: 'docket', tool, input, toolUseId: 'reviewed' },
        },
      },
    })
    .returning();
  if (!activity) throw new Error('Missing activity');
  await schema.db.insert(schema.auditEvent).values({
    organizationId: f.orgId,
    actorId: f.actorId,
    subjectType: 'agent_session',
    subjectId: f.session.id,
    type: 'approved',
    metadata: { activityId: activity.id, approverActorId: f.actorId },
  });
  return activity;
}
const definition = {
  name: 'Event',
  payload: { targetType: 'project', description: 'Prepare event' },
};

// PGlite serializes transactions. Inject approval's state after the stale read so the actual
// conditional update sees the state produced when a competing approval commits first.
function approveAfterRead(activityId: string) {
  interface QueryClient {
    query: (...args: unknown[]) => Promise<unknown>;
  }
  const client = Reflect.get(schema.db, '$client') as {
    transaction: (fn: (tx: QueryClient) => Promise<unknown>) => Promise<unknown>;
  };
  const transaction = client.transaction.bind(client);
  return vi.spyOn(client, 'transaction').mockImplementationOnce((fn) =>
    transaction(async (tx) => {
      const query = tx.query.bind(tx);
      let injected = false;
      tx.query = async (...args) => {
        const result = await query(...args);
        if (
          !injected &&
          String(args[0]).startsWith('select ') &&
          String(args[0]).includes('from "session_activity"')
        ) {
          injected = true;
          await query('UPDATE session_activity SET approval_status = $1 WHERE id = $2', [
            'approved',
            activityId,
          ]);
        }
        return result;
      };
      return fn(tx);
    }),
  );
}

// Inject a competing edit at the SQL boundary after approval read and authorized its snapshots.
// This exercises the real conditional write; it does not claim parallel PostgreSQL scheduling.
function editBeforeDecision(activityId: string, input: Record<string, unknown>) {
  interface QueryClient {
    query: (...args: unknown[]) => Promise<unknown>;
  }
  const client = Reflect.get(schema.db, '$client') as {
    transaction: (fn: (tx: QueryClient) => Promise<unknown>) => Promise<unknown>;
  };
  const transaction = client.transaction.bind(client);
  return vi.spyOn(client, 'transaction').mockImplementationOnce((fn) =>
    transaction(async (tx) => {
      const query = tx.query.bind(tx);
      let injected = false;
      tx.query = async (...args) => {
        if (!injected && String(args[0]).startsWith('update "session_activity"')) {
          injected = true;
          await query(
            "UPDATE session_activity SET body = jsonb_set(body, '{action,toolCall,input}', $1::jsonb) WHERE id = $2",
            [JSON.stringify(input), activityId],
          );
        }
        return query(...args);
      };
      return fn(tx);
    }),
  );
}

describe('exact proposal decision snapshots', () => {
  it.each(['single', 'session', 'group'] as const)(
    'refuses a %s decision when an edit wins after the approval read',
    async (scope) => {
      const f = await fixture();
      const input = { orgId: f.orgId, ...definition };
      const rows = await schema.db
        .insert(schema.sessionActivity)
        .values(
          [0, 1].map((index) => ({
            sessionId: f.session.id,
            organizationId: f.orgId,
            type: 'action' as const,
            approvalStatus: 'proposed' as const,
            proposalGroupId: 'reviewed-group',
            createdAt: new Date(2026, 9, 25, 0, 0, index),
            body: {
              action: {
                kind: 'define_template',
                summary: 'Reviewed definition',
                mode: 'proposal' as const,
                toolCall: {
                  connection: 'docket',
                  tool: 'define_template',
                  input,
                  toolUseId: 'review',
                },
              },
            },
          })),
        )
        .returning();
      const first = rows[0];
      const changed = scope === 'single' ? first : rows[1];
      if (!first || !changed) throw new Error('Missing pending proposals');
      const editedInput = { ...input, name: 'Changed during review' };
      const { decideActivity, decideProposalGroup } =
        await import('../../src/routes/agent-session-approval');
      const decide = () =>
        scope === 'group'
          ? decideProposalGroup(f.orgId, f.actorId, f.session.id, 'reviewed-group', 'approve')
          : decideActivity(f.orgId, f.actorId, f.session.id, first.id, {
              decision: 'approve',
              scope: scope === 'session' ? 'all_in_session' : 'this',
            });
      const interception = editBeforeDecision(changed.id, editedInput);
      try {
        await expect(decide()).rejects.toMatchObject({ code: 'conflict' });
      } finally {
        interception.mockRestore();
      }
      expect(
        await schema.db
          .select()
          .from(schema.sessionActivity)
          .where(eq(schema.sessionActivity.sessionId, f.session.id)),
      ).toEqual(rows);
      expect(
        await schema.db
          .select()
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.subjectId, f.session.id)),
      ).toEqual([]);
      const { editProposalInput } = await import('../../src/agent/proposals');
      await editProposalInput(f.session.id, changed.id, editedInput);
      await decide();
      const [saved] = await schema.db
        .select()
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.id, changed.id));
      expect(saved?.approvalStatus).toBe('approved');
      expect(saved?.body.action?.toolCall?.input).toEqual(editedInput);
    },
  );
});

describe('trusted template approval regressions', () => {
  it('refuses a stale proposal edit when approval wins before its update', async () => {
    const f = await fixture();
    const input = { orgId: f.orgId, ...definition };
    const activity = await approved(f, 'define_template', input);
    await schema.db
      .update(schema.sessionActivity)
      .set({ approvalStatus: 'proposed' })
      .where(eq(schema.sessionActivity.id, activity.id));
    const { editProposalInput } = await import('../../src/agent/proposals');
    const interception = approveAfterRead(activity.id);
    try {
      await expect(
        editProposalInput(f.session.id, activity.id, { ...input, name: 'Unreviewed' }),
      ).rejects.toMatchObject({ code: 'conflict' });
    } finally {
      interception.mockRestore();
    }
    const [saved] = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, activity.id));
    expect(saved?.body.action?.toolCall?.input).toEqual(input);
  });

  it('refuses an approved implicit Undo after another draft becomes the latest receipt', async () => {
    const f = await fixture();
    expect(
      (await f.toolbox.callTool('define_template', { orgId: f.orgId, ...definition })).isError,
    ).toBe(false);
    const input = { orgId: f.orgId };
    await approved(f, 'undo', input);
    expect(
      (
        await f.toolbox.callTool('define_template', {
          orgId: f.orgId,
          ...definition,
          name: 'Later draft',
        })
      ).isError,
    ).toBe(false);
    const before = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.organizationId, f.orgId));
    expect((await f.toolbox.callTool('undo', input)).isError).toBe(true);
    expect(
      await schema.db
        .select()
        .from(schema.template)
        .where(eq(schema.template.organizationId, f.orgId)),
    ).toEqual(before);
  });

  it('binds a reviewed explicit Undo to its receipt even when the wrapper resolves another one', async () => {
    const f = await fixture();
    const first = await f.toolbox.callTool('define_template', { orgId: f.orgId, ...definition });
    const second = await f.toolbox.callTool('define_template', {
      orgId: f.orgId,
      ...definition,
      name: 'Later draft',
    });
    expect(first.isError, first.content).toBe(false);
    expect(second.isError, second.content).toBe(false);
    const firstReceipt = JSON.parse(first.content) as { changeSetId: string };
    const secondReceipt = JSON.parse(second.content) as { changeSetId: string };
    const [firstEntry] = await schema.db
      .select()
      .from(schema.changeSetEntry)
      .where(eq(schema.changeSetEntry.changeSetId, firstReceipt.changeSetId));
    if (!firstEntry) throw new Error('Missing first template receipt entry');
    const input = { orgId: f.orgId, changeSetId: firstReceipt.changeSetId };
    await approved(f, 'undo', input);
    const { registerTemplateExecutor } = await import('../../src/agent/template-authority');
    registerTemplateExecutor(f.ctx, f.session.id);
    const { tryAutomatedTemplateUndo } = await import('../../src/agent/template-undo');
    const { workScheduleUndoAccess } =
      await import('../../src/lib/recurrence/work-schedule-undo-access');
    const caller = { orgId: f.orgId, actorId: f.actorId };
    const before = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.organizationId, f.orgId));
    await expect(
      tryAutomatedTemplateUndo(
        f.ctx,
        caller,
        secondReceipt.changeSetId,
        input,
        workScheduleUndoAccess(caller),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      await schema.db
        .select()
        .from(schema.template)
        .where(eq(schema.template.organizationId, f.orgId)),
    ).toEqual(before);
    const undone = await f.toolbox.callTool('undo', input);
    expect(undone.isError, undone.content).toBe(false);
    const remaining = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.organizationId, f.orgId));
    expect(remaining).toEqual(before.filter((row) => row.id !== firstEntry.entityId));
    expect(remaining.some((row) => row.name === 'Later draft')).toBe(true);
  });

  it('executes a reviewed name after the MCP schema trims surrounding whitespace', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.hub)
      .set({ preferences: { athena: { approvalMode: 'ask_before_acting' } } })
      .where(eq(schema.hub.userId, f.userId));
    const input = { orgId: f.orgId, ...definition, name: '  Reviewed Event  ' };
    await approved(f, 'define_template', input);
    const result = await f.toolbox.callTool('define_template', input);
    expect(result.isError, result.content).toBe(false);
    const rows = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.organizationId, f.orgId));
    expect(
      rows.some((row) => row.name === 'Reviewed Event' && row.publicationState === 'draft'),
    ).toBe(true);
  });

  it('accepts omitted schedule defaults while refusing an authored cadence change', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.hub)
      .set({ preferences: { athena: { approvalMode: 'ask_before_acting' } } })
      .where(eq(schema.hub.userId, f.userId));
    const input = {
      orgId: f.orgId,
      name: 'Program',
      action: 'draft',
      payload: { targetType: 'program' },
      defaultSchedules: [
        {
          key: 'weekly',
          name: 'Weekly review',
          template: {
            targetType: 'task',
            workTypeId: schema.genId(),
            selection: { kind: 'latest' },
          },
          titlePattern: 'Review',
          cadence: { kind: 'daily' },
          teamRule: 'none',
          actorRule: 'creator',
        },
      ],
    };
    await approved(f, 'define_template', input);
    const { defineTemplateDefinition } = await import('../../src/mcp/template-tools-contract');
    const parsed = z.object(defineTemplateDefinition.inputSchema).parse(input);
    expect(parsed.defaultSchedules?.[0]?.cadence).toEqual({
      kind: 'daily',
      interval: 1,
      startOffsetDays: 0,
      end: { kind: 'never' },
    });
    const { registerTemplateExecutor, requireAutomatedTemplateAuthor } =
      await import('../../src/agent/template-authority');
    registerTemplateExecutor(f.ctx, f.session.id);
    const caller = { orgId: f.orgId, actorId: f.actorId };
    await expect(requireAutomatedTemplateAuthor(f.ctx, caller, parsed)).resolves.toBeUndefined();
    const altered = z.object(defineTemplateDefinition.inputSchema).parse({
      ...input,
      defaultSchedules: [{ ...input.defaultSchedules[0], cadence: { kind: 'daily', interval: 2 } }],
    });
    await expect(requireAutomatedTemplateAuthor(f.ctx, caller, altered)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('rechecks Athena policy inside the specialized copy Undo transaction', async () => {
    const f = await templateGalleryFixture(schema);
    const installed = await installTemplateGallery(f);
    await grantDocketPro(schema.db, schema, f.orgId);
    const execution = await executor(f.orgId, f.userId);
    const input = { orgId: f.orgId, changeSetId: installed.receipt.changeSetId };
    await approved(
      { orgId: f.orgId, actorId: f.humanActorId, session: execution.session },
      'undo',
      input,
    );
    const { internalUserContext } = await import('../../src/mcp/internal-session');
    const ctx = await internalUserContext(f.userId);
    const { registerTemplateExecutor } = await import('../../src/agent/template-authority');
    registerTemplateExecutor(ctx, execution.session.id);
    const { tryAutomatedTemplateUndo } = await import('../../src/agent/template-undo');
    const { workScheduleUndoAccess } =
      await import('../../src/lib/recurrence/work-schedule-undo-access');
    const before = await galleryUndoState(f, installed);
    const original = serializable.serializableTx;
    const interception = vi
      .spyOn(serializable, 'serializableTx')
      .mockImplementationOnce(async (fn) => {
        await schema.db
          .update(schema.hub)
          .set({ preferences: { athena: { approvalMode: 'suggest_only' } } })
          .where(eq(schema.hub.userId, f.userId));
        return original(fn);
      });
    try {
      await expect(
        tryAutomatedTemplateUndo(
          ctx,
          f.caller,
          input.changeSetId,
          input,
          workScheduleUndoAccess(f.caller),
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
    } finally {
      interception.mockRestore();
    }
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });
});
