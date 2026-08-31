import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  agentDelegation,
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

describe('Lattice reply-key lifecycle migration', () => {
  it('settles an existing proposed row that cannot regain its cleared reply key', async () => {
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
    await db.insert(agentDelegation).values({
      id: 'delegation_lattice_upgrade',
      ownerUserId: 'user_lattice_upgrade',
      organizationId: 'org_lattice_upgrade',
      assignmentId: 'assignment_lattice_upgrade',
      sessionId: 'session_lattice_upgrade',
      connectionId: 'connection_lattice_upgrade',
      runtimeId: 'lat_upgrade',
      logicalSubmissionId: 'athena:delegation_lattice_upgrade',
      workId: 'work_lattice_upgrade',
      replyKeyCiphertext: null,
      status: 'proposed',
      terminalOutcome: { outcome: 'completed', payload: { outputText: 'Opened result' } },
      returnedActivityId: 'activity_lattice_upgrade',
    });

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
  });
});
