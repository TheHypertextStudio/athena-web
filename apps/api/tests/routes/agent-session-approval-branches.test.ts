/**
 * `agent-session-approval` branch-coverage top-up.
 *
 * @remarks
 * Calls `resolveAction`, `decideActivity`, and `replyToElicitation` directly rather than through
 * the router: the branches below (cross-tenant registered sessions, a session-level `approved`
 * decision, a drifted agent-workspace lookup, and a batch decision whose target isn't the named
 * activity) are either never reached by the router in test mode (the Athena-async path requires
 * production config) or never exercised by any existing HTTP-level test.
 */
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  decideActivity as DecideActivity,
  replyToElicitation as ReplyToElicitation,
  resolveAction as ResolveAction,
} from '../../src/routes/agent-session-approval';
import { getDb, one } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let resolveAction!: typeof ResolveAction;
let decideActivity!: typeof DecideActivity;
let replyToElicitation!: typeof ReplyToElicitation;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ resolveAction, decideActivity, replyToElicitation } =
    await import('../../src/routes/agent-session-approval'));
});

/** A registered (non-Athena) agent session fixture: org, human, agent (+ its actor), task. */
interface Fixture {
  readonly orgId: string;
  readonly humanActorId: string;
  readonly agentId: string;
  readonly agentActorId: string;
  readonly taskId: string;
}

async function seedFixture(label: string): Promise<Fixture> {
  const slug = `appr-${label}-${Math.random().toString(36).slice(2, 8)}`;
  const orgId = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  ).id;
  const teamId = one(
    await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Core', key: `K${slug.slice(-4).toUpperCase()}` })
      .returning({ id: schema.team.id }),
  ).id;
  const humanActorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
      .returning({ id: schema.actor.id }),
  ).id;
  const agentActorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Runner' })
      .returning({ id: schema.actor.id }),
  ).id;
  const agentId = one(
    await db
      .insert(schema.agent)
      .values({ organizationId: orgId, actorId: agentActorId, createdBy: humanActorId })
      .returning({ id: schema.agent.id }),
  ).id;
  const taskId = one(
    await db
      .insert(schema.task)
      .values({ organizationId: orgId, title: 'Ship it', teamId, state: 'todo' })
      .returning({ id: schema.task.id }),
  ).id;
  return { orgId, humanActorId, agentId, agentActorId, taskId };
}

/** Insert a registered-agent session in the given status. */
async function seedSession(
  fixture: Fixture,
  status: 'pending' | 'running' | 'awaiting_approval' | 'awaiting_input' = 'awaiting_approval',
): Promise<string> {
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        organizationId: fixture.orgId,
        agentId: fixture.agentId,
        taskId: fixture.taskId,
        trigger: 'assignment',
        status,
        initiatorId: fixture.humanActorId,
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
}

/** Insert one proposed `action` activity. */
async function seedProposedAction(sessionId: string, orgId: string, summary: string) {
  return one(
    await db
      .insert(schema.sessionActivity)
      .values({
        sessionId,
        organizationId: orgId,
        type: 'action',
        body: { action: { kind: 'update_task', summary } },
        approvalStatus: 'proposed',
      })
      .returning({ id: schema.sessionActivity.id }),
  ).id;
}

describe('assertSessionContext', () => {
  it('resolveAction throws not-found for a session id that does not exist', async () => {
    const fixture = await seedFixture('missing-session');
    await expect(resolveAction(fixture.orgId, 'sess_does_not_exist', 'rejected')).rejects.toThrow(
      'Session not found',
    );
  });

  it('decideActivity hides a registered session that belongs to a different org', async () => {
    const owner = await seedFixture('tenant-owner');
    const intruder = await seedFixture('tenant-intruder');
    const sessionId = await seedSession(owner);
    const activityId = await seedProposedAction(sessionId, owner.orgId, 'x');

    await expect(
      decideActivity(intruder.orgId, null, sessionId, activityId, { decision: 'approve' }),
    ).rejects.toThrow('Session not found');
  });
});

describe('authorizeApprovalTarget — registered agent whose workspace has drifted', () => {
  it('falls back to a null approver actor when the agent no longer resolves in the session workspace', async () => {
    const fixture = await seedFixture('drifted-agent');
    const otherOrgId = one(
      await db
        .insert(schema.organization)
        .values({
          name: `drift-${Math.random().toString(36).slice(2, 8)}`,
          slug: `drift-${Math.random().toString(36).slice(2, 8)}`,
          lifecycleState: 'active',
        })
        .returning({ id: schema.organization.id }),
    ).id;
    const sessionId = await seedSession(fixture);
    const activityId = await seedProposedAction(sessionId, fixture.orgId, 'moved');
    // Simulate drift: the agent's own workspace no longer matches the session's cached org, so
    // the join in `authorizeApprovalTarget` finds no row and falls back to `actorId: null`.
    await db
      .update(schema.agent)
      .set({ organizationId: otherOrgId })
      .where(eq(schema.agent.id, fixture.agentId));

    const decided = await decideActivity(fixture.orgId, 'approver_x', sessionId, activityId, {
      decision: 'approve',
    });
    expect(decided.approvalStatus).toBe('approved');

    const audits = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.subjectId, sessionId),
          eq(schema.auditEvent.organizationId, fixture.orgId),
        ),
      );
    expect(audits[0]?.actorId).toBeNull();
    expect(audits[0]?.metadata).toMatchObject({ approverActorId: 'approver_x' });
  });
});

describe('resolveAction — session-level decisions', () => {
  it('refuses to decide a session that is not awaiting approval', async () => {
    const fixture = await seedFixture('not-awaiting');
    const sessionId = await seedSession(fixture, 'running');
    await expect(resolveAction(fixture.orgId, sessionId, 'rejected')).rejects.toThrow(
      'Session is not awaiting approval',
    );
  });

  it('approves the latest proposed action, advancing the session to running with no endedAt', async () => {
    const fixture = await seedFixture('approve-latest');
    const sessionId = await seedSession(fixture);
    await seedProposedAction(sessionId, fixture.orgId, 'approve me');

    const updated = await resolveAction(fixture.orgId, sessionId, 'approved');

    expect(updated.status).toBe('running');
    expect(updated.endedAt).toBeNull();
  });
});

describe('decideActivity — batch scope covers every proposed action, not just the named one', () => {
  it('rejects every proposed action in the session and records each independently', async () => {
    const fixture = await seedFixture('batch-reject');
    const sessionId = await seedSession(fixture);
    const named = await seedProposedAction(sessionId, fixture.orgId, 'first');
    const other = await seedProposedAction(sessionId, fixture.orgId, 'second');

    const decided = await decideActivity(fixture.orgId, fixture.humanActorId, sessionId, named, {
      decision: 'reject',
      scope: 'all_in_session',
    });
    expect(decided.id).toBe(named);
    expect(decided.approvalStatus).toBe('rejected');

    const rows = await db
      .select({ id: schema.sessionActivity.id, status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, sessionId));
    const otherRow = rows.find((row) => row.id === other);
    expect(otherRow?.status).toBe('rejected');

    const audits = await db
      .select({ metadata: schema.auditEvent.metadata })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.subjectId, sessionId));
    const activityIds = audits.map(
      (audit) => (audit.metadata as { activityId?: string }).activityId,
    );
    expect(new Set(activityIds)).toEqual(new Set([named, other]));
  });
});

describe('replyToElicitation — duplicate replies', () => {
  it('refuses a second reply to the same tool-use elicitation', async () => {
    const fixture = await seedFixture('duplicate-reply');
    const sessionId = await seedSession(fixture, 'awaiting_input');
    const elicitationId = one(
      await db
        .insert(schema.sessionActivity)
        .values({
          sessionId,
          organizationId: fixture.orgId,
          type: 'elicitation',
          body: { text: 'Which one?', toolUseId: 'tool-use-1' },
        })
        .returning({ id: schema.sessionActivity.id }),
    ).id;

    await replyToElicitation(fixture.orgId, sessionId, elicitationId, 'The first one.');
    await expect(
      replyToElicitation(fixture.orgId, sessionId, elicitationId, 'Changed my mind.'),
    ).rejects.toThrow('Elicitation already has a reply');
  });
});
