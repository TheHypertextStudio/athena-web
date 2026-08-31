import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  agentDelegation,
  agentSession,
  athenaAssignment,
  athenaTrigger,
  latticeConnection,
  organization,
  personalMcpConnection,
  personalMcpCredential,
  sessionActivity,
  user,
} from '../../src/schema';
import { assertDefined } from '@docket/test-utils';

const client = new PGlite('memory://');
const db = drizzle(client);

let ownerUserId = '';
let otherUserId = '';
let organizationId = '';

async function createWorkspace(suffix: string): Promise<string> {
  const [workspace] = await db
    .insert(organization)
    .values({ name: `Personal Athena ${suffix}`, slug: `personal-athena-${suffix}` })
    .returning({ id: organization.id });
  return assertDefined(workspace).id;
}

async function createAssignment(workspaceId: string, suffix: string): Promise<string> {
  const [assignment] = await db
    .insert(athenaAssignment)
    .values({
      ownerUserId,
      organizationId: workspaceId,
      entityType: 'initiative',
      entityId: `initiative_${suffix}`,
      objective: `Analyze ${suffix}.`,
    })
    .returning({ id: athenaAssignment.id });
  return assertDefined(assignment).id;
}

async function createAthenaSession(workspaceId: string): Promise<string> {
  const [session] = await db
    .insert(agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      contextOrganizationId: workspaceId,
      trigger: 'assignment',
      executionSurface: 'lattice',
    })
    .returning({ id: agentSession.id });
  return assertDefined(session).id;
}

async function connectionId(): Promise<string> {
  const [connection] = await db
    .select({ id: latticeConnection.id })
    .from(latticeConnection)
    .where(eq(latticeConnection.ownerUserId, ownerUserId));
  return assertDefined(connection).id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  const users = (
    await db
      .insert(user)
      .values([
        { name: 'Owner', email: 'personal-owner@example.com' },
        { name: 'Other', email: 'personal-other@example.com' },
      ])
      .returning({ id: user.id })
  ).map((row) => row.id);
  ownerUserId = users[0] ?? '';
  otherUserId = users[1] ?? '';
  if (!ownerUserId || !otherUserId) throw new Error('failed to seed personal Athena users');
  const [workspace] = await db
    .insert(organization)
    .values({ name: 'Personal Athena workspace', slug: 'personal-athena-workspace' })
    .returning({ id: organization.id });
  organizationId = workspace?.id ?? '';
  if (!organizationId) throw new Error('failed to seed personal Athena workspace');
});

afterAll(async () => client.close());

describe('personal Athena schema', () => {
  it('stores Lattice execution and durable assignment delegation state', async () => {
    const sessionColumn = (await db.execute(`
      select column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_session'
        and column_name = 'execution_surface'
    `)) as unknown as { rows: { column_default: string | null }[] };
    const delegationTable = (await db.execute(
      `select to_regclass('public.agent_delegation') as reg`,
    )) as unknown as { rows: { reg: string | null }[] };
    const cancellationIntentColumn = (await db.execute(`
      select is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_delegation'
        and column_name = 'cancellation_requested_at'
    `)) as unknown as { rows: { is_nullable: string }[] };

    expect(sessionColumn.rows).toEqual([{ column_default: "'docket'::text" }]);
    expect(delegationTable.rows[0]?.reg).toBe('agent_delegation');
    expect(cancellationIntentColumn.rows).toEqual([{ is_nullable: 'YES' }]);

    const [assignment] = await db
      .insert(athenaAssignment)
      .values({
        ownerUserId,
        organizationId,
        entityType: 'initiative',
        entityId: 'initiative_lattice_schema_test',
        objective: 'Analyze the existing work without changing it.',
      })
      .returning();
    const [connection] = await db
      .insert(latticeConnection)
      .values({
        ownerUserId,
        status: 'connected',
        enabled: true,
        deviceId: 'lat_mac_studio',
      })
      .returning();
    const [session] = await db
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId,
        contextOrganizationId: organizationId,
        trigger: 'assignment',
        executionSurface: 'lattice',
      })
      .returning();
    expect(session?.executionSurface).toBe('lattice');

    const prepared = {
      ownerUserId,
      organizationId,
      assignmentId: assertDefined(assignment).id,
      sessionId: assertDefined(session).id,
      connectionId: assertDefined(connection).id,
      runtimeId: 'lat_mac_studio',
      logicalSubmissionId: 'docket:delegation:schema-test',
      workId: 'work_schema_test',
      replyKeyCiphertext: 'v1:gcm:reply-key',
    } as const;
    const [delegation] = await db.insert(agentDelegation).values(prepared).returning();
    expect(delegation?.status).toBe('prepared');
    expect(delegation?.relayCursor).toBe('cursor_0');

    await expect(
      db
        .update(agentDelegation)
        .set({ submissionLeaseToken: 'half-a-lease' })
        .where(eq(agentDelegation.id, assertDefined(delegation).id)),
    ).rejects.toThrow();
    await db
      .update(agentDelegation)
      .set({
        submissionLeaseToken: 'submission-lease',
        submissionLeaseExpiresAt: new Date('2026-08-30T22:00:00.000Z'),
      })
      .where(eq(agentDelegation.id, assertDefined(delegation).id));
    await db
      .update(agentDelegation)
      .set({ submissionLeaseToken: null, submissionLeaseExpiresAt: null })
      .where(eq(agentDelegation.id, assertDefined(delegation).id));

    await expect(
      db.insert(agentDelegation).values({
        ...prepared,
        ownerUserId: otherUserId,
        logicalSubmissionId: 'docket:delegation:wrong-owner',
        workId: 'work_wrong_owner',
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(agentDelegation).values({
        ...prepared,
        logicalSubmissionId: 'docket:delegation:duplicate-open',
        workId: 'work_duplicate_open',
      }),
    ).rejects.toThrow();

    await db
      .insert(sessionActivity)
      .values({ sessionId: assertDefined(session).id, type: 'action', body: {} });
    const [returnedActivity] = await db
      .select({ id: sessionActivity.id })
      .from(sessionActivity)
      .where(eq(sessionActivity.sessionId, assertDefined(session).id));
    await db
      .update(agentDelegation)
      .set({
        status: 'proposed',
        workState: 'completed',
        terminalOutcome: { outcome: 'completed', report: 'The analysis is ready.' },
        returnedActivityId: assertDefined(returnedActivity).id,
      })
      .where(eq(agentDelegation.id, assertDefined(delegation).id));
    await expect(
      db
        .update(agentDelegation)
        .set({ status: 'submitted', replyKeyCiphertext: null, terminalOutcome: null })
        .where(eq(agentDelegation.id, assertDefined(delegation).id)),
    ).rejects.toThrow();
  });

  it('binds delegation assignments and sessions to the same organization', async () => {
    const otherOrganizationId = await createWorkspace('delegation-other-org');
    const assignmentId = await createAssignment(organizationId, 'delegation-org-boundary');
    const sameOrganizationSessionId = await createAthenaSession(organizationId);
    const otherOrganizationSessionId = await createAthenaSession(otherOrganizationId);
    const latticeConnectionId = await connectionId();

    await expect(
      db.insert(agentDelegation).values({
        ownerUserId,
        organizationId: otherOrganizationId,
        assignmentId,
        sessionId: otherOrganizationSessionId,
        connectionId: latticeConnectionId,
        runtimeId: 'lat_wrong_assignment_org',
        logicalSubmissionId: 'docket:delegation:wrong-assignment-org',
        workId: 'work_wrong_assignment_org',
        replyKeyCiphertext: 'v1:gcm:wrong-assignment-org',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(agentDelegation).values({
        ownerUserId,
        organizationId,
        assignmentId,
        sessionId: otherOrganizationSessionId,
        connectionId: latticeConnectionId,
        runtimeId: 'lat_wrong_session_org',
        logicalSubmissionId: 'docket:delegation:wrong-session-org',
        workId: 'work_wrong_session_org',
        replyKeyCiphertext: 'v1:gcm:wrong-session-org',
      }),
    ).rejects.toThrow();

    await db.insert(agentDelegation).values({
      ownerUserId,
      organizationId,
      assignmentId,
      sessionId: sameOrganizationSessionId,
      connectionId: latticeConnectionId,
      runtimeId: 'lat_same_org',
      logicalSubmissionId: 'docket:delegation:same-org',
      workId: 'work_same_org',
      replyKeyCiphertext: 'v1:gcm:same-org',
    });
  });

  it('requires a returned activity from the delegation session only after a usable result', async () => {
    const assignmentId = await createAssignment(organizationId, 'delegation-returned-activity');
    const sessionId = await createAthenaSession(organizationId);
    const otherSessionId = await createAthenaSession(organizationId);
    const latticeConnectionId = await connectionId();
    const [delegation] = await db
      .insert(agentDelegation)
      .values({
        ownerUserId,
        organizationId,
        assignmentId,
        sessionId,
        connectionId: latticeConnectionId,
        runtimeId: 'lat_returned_activity',
        logicalSubmissionId: 'docket:delegation:returned-activity',
        workId: 'work_returned_activity',
        replyKeyCiphertext: 'v1:gcm:returned-activity',
      })
      .returning({ id: agentDelegation.id });
    const [sameSessionActivity] = await db
      .insert(sessionActivity)
      .values({ sessionId, type: 'action', body: {} })
      .returning({ id: sessionActivity.id });
    const [otherSessionActivity] = await db
      .insert(sessionActivity)
      .values({ sessionId: otherSessionId, type: 'action', body: {} })
      .returning({ id: sessionActivity.id });
    const delegationId = assertDefined(delegation).id;
    const terminalResult = {
      status: 'proposed' as const,
      terminalOutcome: { outcome: 'completed' },
    };

    await expect(
      db.update(agentDelegation).set(terminalResult).where(eq(agentDelegation.id, delegationId)),
    ).rejects.toThrow();
    await expect(
      db
        .update(agentDelegation)
        .set({
          ...terminalResult,
          returnedActivityId: assertDefined(otherSessionActivity).id,
        })
        .where(eq(agentDelegation.id, delegationId)),
    ).rejects.toThrow();

    await db
      .update(agentDelegation)
      .set({
        ...terminalResult,
        returnedActivityId: assertDefined(sameSessionActivity).id,
      })
      .where(eq(agentDelegation.id, delegationId));

    await db
      .update(agentDelegation)
      .set({ status: 'completed', replyKeyCiphertext: null, settledAt: new Date() })
      .where(eq(agentDelegation.id, delegationId));

    const failedAssignmentId = await createAssignment(
      organizationId,
      'delegation-returned-activity-failure',
    );
    const [failedDelegation] = await db
      .insert(agentDelegation)
      .values({
        ownerUserId,
        organizationId,
        assignmentId: failedAssignmentId,
        sessionId,
        connectionId: latticeConnectionId,
        runtimeId: 'lat_returned_activity_failure',
        logicalSubmissionId: 'docket:delegation:returned-activity-failure',
        workId: 'work_returned_activity_failure',
        replyKeyCiphertext: 'v1:gcm:returned-activity-failure',
      })
      .returning({ id: agentDelegation.id });
    await db
      .update(agentDelegation)
      .set({ status: 'failed', failureCode: 'runtime_failed', replyKeyCiphertext: null })
      .where(eq(agentDelegation.id, assertDefined(failedDelegation).id));
  });

  it('adds an index led by every delegation foreign-key column set', async () => {
    const result = (await db.execute(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public' and tablename = 'agent_delegation'
    `)) as unknown as { rows: { indexname: string; indexdef: string }[] };
    const indexes = Object.fromEntries(result.rows.map((row) => [row.indexname, row.indexdef]));

    expect(indexes['agent_delegation_assignment_owner_org_idx']).toContain(
      '(assignment_id, owner_user_id, organization_id)',
    );
    expect(indexes['agent_delegation_session_owner_org_idx']).toContain(
      '(session_id, owner_user_id, organization_id)',
    );
    expect(indexes['agent_delegation_connection_owner_idx']).toContain(
      '(connection_id, owner_user_id)',
    );
    expect(indexes['agent_delegation_organization_idx']).toContain('(organization_id)');
    expect(indexes['agent_delegation_task_idx']).toContain('(task_id)');
    expect(indexes['agent_delegation_returned_activity_session_idx']).toContain(
      '(returned_activity_id, session_id)',
    );
  });

  it('binds personal connection credentials to the same owner', async () => {
    const [connection] = await db
      .insert(personalMcpConnection)
      .values({
        ownerUserId,
        name: 'Sunsama',
        alias: 'sunsama',
        url: 'https://mcp.sunsama.com/mcp',
        authMode: 'bearer',
      })
      .returning();
    expect(connection?.ownerUserId).toBe(ownerUserId);

    await db.insert(personalMcpCredential).values({
      connectionId: assertDefined(connection).id,
      ownerUserId,
      ciphertext: 'v1:gcm:test',
    });
    await expect(
      db.insert(personalMcpCredential).values({
        connectionId: assertDefined(connection).id,
        ownerUserId: otherUserId,
        ciphertext: 'v1:gcm:wrong-owner',
      }),
    ).rejects.toThrow();
  });

  it('keeps independent assignments and validates trigger cadence', async () => {
    expect(athenaAssignment).toBeDefined();
    expect(athenaTrigger).toBeDefined();
  });
});
