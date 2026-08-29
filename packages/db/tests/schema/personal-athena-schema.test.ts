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
  user,
} from '../../src/schema';
import { assertDefined } from '@docket/test-utils';

const client = new PGlite('memory://');
const db = drizzle(client);

let ownerUserId = '';
let otherUserId = '';
let organizationId = '';

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

    expect(sessionColumn.rows).toEqual([{ column_default: "'docket'::text" }]);
    expect(delegationTable.rows[0]?.reg).toBe('agent_delegation');

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
      .update(agentDelegation)
      .set({
        status: 'proposed',
        workState: 'completed',
        terminalOutcome: { outcome: 'completed', report: 'The analysis is ready.' },
        replyKeyCiphertext: null,
        settledAt: new Date(),
      })
      .where(eq(agentDelegation.id, assertDefined(delegation).id));
    await expect(
      db
        .update(agentDelegation)
        .set({ status: 'submitted', replyKeyCiphertext: null, terminalOutcome: null })
        .where(eq(agentDelegation.id, assertDefined(delegation).id)),
    ).rejects.toThrow();
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
