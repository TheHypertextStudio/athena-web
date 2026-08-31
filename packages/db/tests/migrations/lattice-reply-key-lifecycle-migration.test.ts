import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  agentSession,
  athenaAssignment,
  latticeConnection,
  organization,
  sessionActivity,
  user,
} from '../../src/schema';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const migrationName = '0115_violet_squadron_supreme.sql';
const clients: PGlite[] = [];

function migrationSql(through: string): string {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql') && file <= through)
    .sort()
    .map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8'))
    .join('\n');
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

/**
 * Seed one legacy null-key delegation with raw SQL naming only pre-0115 columns.
 *
 * @remarks
 * The database under test is deliberately migrated only THROUGH 0114 — that is the era the
 * upgrade path starts from. Inserting through the current Drizzle table would name every column
 * the schema has TODAY (0116's `cancellation_requested_at` and whatever comes after), which the
 * 0114-era database rightly rejects. Raw SQL keeps the fixture pinned to the era it fakes, so a
 * future schema column never breaks a test about a past migration.
 */
async function insertLegacyDelegation(client: PGlite, suffix: string): Promise<void> {
  const key = suffix.length > 0 ? `_${suffix}` : '';
  await client.query(
    `INSERT INTO agent_delegation
       (id, owner_user_id, organization_id, assignment_id, session_id, connection_id,
        runtime_id, logical_submission_id, work_id, reply_key_ciphertext, status,
        terminal_outcome, returned_activity_id)
     VALUES ($1, 'user_lattice_upgrade', 'org_lattice_upgrade', $2, $3,
        'connection_lattice_upgrade', 'lat_upgrade', $4, $5, NULL, 'proposed', $6, $7)`,
    [
      `delegation_lattice_upgrade${key}`,
      `assignment_lattice_upgrade${key}`,
      `session_lattice_upgrade${key}`,
      `athena:delegation_lattice_upgrade${key}`,
      `work_lattice_upgrade${key}`,
      JSON.stringify({ outcome: 'completed', payload: { outputText: 'Opened result' } }),
      `activity_lattice_upgrade${key}`,
    ],
  );
}

describe('Lattice reply-key lifecycle migration', () => {
  it('settles legacy null-key proposals without losing applied result history', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    await client.exec(migrationSql('0114_hard_demogoblin.sql'));
    const db = drizzle(client);

    await db.insert(organization).values({
      id: 'org_lattice_upgrade',
      name: 'Lattice upgrade',
      slug: 'lattice-upgrade',
      lifecycleState: 'active',
    });
    await db.insert(user).values({
      id: 'user_lattice_upgrade',
      name: 'Upgrade owner',
      email: 'lattice-upgrade@example.test',
    });
    await db.insert(latticeConnection).values({
      id: 'connection_lattice_upgrade',
      ownerUserId: 'user_lattice_upgrade',
      status: 'connected',
      enabled: true,
      deviceId: 'lat_upgrade',
      accountId: 'acct_upgrade',
    });
    await db.insert(athenaAssignment).values({
      id: 'assignment_lattice_upgrade',
      ownerUserId: 'user_lattice_upgrade',
      organizationId: 'org_lattice_upgrade',
      entityType: 'task',
      entityId: 'task_upgrade',
      objective: 'Prove the migration upgrade path.',
    });
    await db.insert(athenaAssignment).values({
      id: 'assignment_lattice_upgrade_malformed_result',
      ownerUserId: 'user_lattice_upgrade',
      organizationId: 'org_lattice_upgrade',
      entityType: 'task',
      entityId: 'task_upgrade_malformed_result',
      objective: 'Prove malformed legacy result data cannot abort the upgrade.',
    });
    await db.insert(athenaAssignment).values({
      id: 'assignment_lattice_upgrade_applied_result',
      ownerUserId: 'user_lattice_upgrade',
      organizationId: 'org_lattice_upgrade',
      entityType: 'task',
      entityId: 'task_upgrade_applied_result',
      objective: 'Preserve an already-applied result through the upgrade.',
    });
    await db.insert(agentSession).values({
      id: 'session_lattice_upgrade',
      executorKind: 'athena',
      ownerUserId: 'user_lattice_upgrade',
      contextOrganizationId: 'org_lattice_upgrade',
      trigger: 'assignment',
      executionSurface: 'lattice',
      status: 'awaiting_approval',
      currentStep: 'Waiting for review',
    });
    await db.insert(sessionActivity).values({
      id: 'activity_lattice_upgrade',
      sessionId: 'session_lattice_upgrade',
      organizationId: 'org_lattice_upgrade',
      type: 'action',
      approvalStatus: 'proposed',
      body: { action: { kind: 'comment', summary: 'Review result', mode: 'proposal' } },
    });
    await insertLegacyDelegation(client, '');
    await db.insert(agentSession).values({
      id: 'session_lattice_upgrade_malformed_result',
      executorKind: 'athena',
      ownerUserId: 'user_lattice_upgrade',
      contextOrganizationId: 'org_lattice_upgrade',
      trigger: 'assignment',
      executionSurface: 'lattice',
      status: 'awaiting_approval',
      currentStep: 'Waiting for review',
    });
    await db.insert(sessionActivity).values({
      id: 'activity_lattice_upgrade_malformed_result',
      sessionId: 'session_lattice_upgrade_malformed_result',
      organizationId: 'org_lattice_upgrade',
      type: 'action',
      approvalStatus: 'applied',
      body: {
        action: {
          kind: 'comment',
          summary: 'Review result',
          mode: 'proposal',
          result: { content: 'Comment created', isError: false },
        },
      },
    });
    await client.exec(
      `UPDATE session_activity
       SET body = jsonb_set(body, '{action,result,isError}', '"unknown"'::jsonb)
       WHERE id = 'activity_lattice_upgrade_malformed_result'`,
    );
    await insertLegacyDelegation(client, 'malformed_result');
    await db.insert(agentSession).values({
      id: 'session_lattice_upgrade_applied_result',
      executorKind: 'athena',
      ownerUserId: 'user_lattice_upgrade',
      contextOrganizationId: 'org_lattice_upgrade',
      trigger: 'assignment',
      executionSurface: 'lattice',
      status: 'awaiting_approval',
      currentStep: 'Waiting for review',
    });
    await db.insert(sessionActivity).values({
      id: 'activity_lattice_upgrade_applied_result',
      sessionId: 'session_lattice_upgrade_applied_result',
      organizationId: 'org_lattice_upgrade',
      type: 'action',
      approvalStatus: 'applied',
      body: {
        action: {
          kind: 'comment',
          summary: 'Review result',
          mode: 'proposal',
          result: { content: 'Comment created', isError: false },
        },
      },
    });
    await insertLegacyDelegation(client, 'applied_result');

    await client.exec(readFileSync(resolve(migrationsFolder, migrationName), 'utf8'));

    const delegation = await client.query<{
      failure_code: string | null;
      returned_activity_id: string | null;
      settled_at: Date | null;
      status: string;
    }>(
      `SELECT status, failure_code, returned_activity_id, settled_at
       FROM agent_delegation WHERE id = 'delegation_lattice_upgrade'`,
    );
    expect(delegation.rows[0]).toMatchObject({
      status: 'failed',
      failure_code: 'result_key_invalid',
      returned_activity_id: null,
      settled_at: expect.any(Date),
    });
    const activity = await client.query<{ approval_status: string }>(
      `SELECT approval_status FROM session_activity WHERE id = 'activity_lattice_upgrade'`,
    );
    expect(activity.rows[0]?.approval_status).toBe('rejected');
    const session = await client.query<{ ended_at: Date | null; status: string }>(
      `SELECT status, ended_at FROM agent_session WHERE id = 'session_lattice_upgrade'`,
    );
    expect(session.rows[0]).toMatchObject({ status: 'failed', ended_at: expect.any(Date) });
    const malformedResultDelegation = await client.query<{
      failure_code: string | null;
      returned_activity_id: string | null;
      status: string;
    }>(
      `SELECT status, failure_code, returned_activity_id
       FROM agent_delegation WHERE id = 'delegation_lattice_upgrade_malformed_result'`,
    );
    expect(malformedResultDelegation.rows[0]).toMatchObject({
      status: 'completed',
      failure_code: null,
      returned_activity_id: 'activity_lattice_upgrade_malformed_result',
    });
    const malformedResultSession = await client.query<{ ended_at: Date | null; status: string }>(
      `SELECT status, ended_at FROM agent_session
       WHERE id = 'session_lattice_upgrade_malformed_result'`,
    );
    expect(malformedResultSession.rows[0]).toMatchObject({
      status: 'completed',
      ended_at: expect.any(Date),
    });
    const appliedResultDelegation = await client.query<{
      failure_code: string | null;
      returned_activity_id: string | null;
      status: string;
    }>(
      `SELECT status, failure_code, returned_activity_id
       FROM agent_delegation WHERE id = 'delegation_lattice_upgrade_applied_result'`,
    );
    expect(appliedResultDelegation.rows[0]).toMatchObject({
      status: 'completed',
      failure_code: null,
      returned_activity_id: 'activity_lattice_upgrade_applied_result',
    });
    const appliedResultSession = await client.query<{ ended_at: Date | null; status: string }>(
      `SELECT status, ended_at FROM agent_session
       WHERE id = 'session_lattice_upgrade_applied_result'`,
    );
    expect(appliedResultSession.rows[0]).toMatchObject({
      status: 'completed',
      ended_at: expect.any(Date),
    });
  });
});
