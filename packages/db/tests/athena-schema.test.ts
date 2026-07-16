import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { TurnMessage } from '@docket/types';

import {
  actor,
  agent,
  agentSession,
  agentSessionRun,
  agentSessionTranscript,
  integration,
  integrationCredential,
  organization,
  sessionActivity,
  sessionKind,
  agentSessionRunStatus,
  user,
} from '../src/schema';
import type { SessionActivityBody } from '../src/types';

/**
 * Schema coverage for the Athena agent additions: the durable session transcript,
 * proposal groups on activities, the chat|job session kind, and org-held integration
 * credentials.
 */

const client = new PGlite('memory://');
const db = drizzle(client);

const ids: Record<string, string> = {};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });

  ids['user'] = (
    await db
      .insert(user)
      .values({ name: 'Willie', email: 'w@example.com', emailVerified: true })
      .returning()
  )[0]!.id;
  ids['org'] = (
    await db.insert(organization).values({ name: 'Acme', slug: 'acme' }).returning()
  )[0]!.id;
  ids['humanActor'] = (
    await db
      .insert(actor)
      .values({
        organizationId: ids['org'],
        kind: 'human',
        displayName: 'Willie',
        userId: ids['user'],
      })
      .returning()
  )[0]!.id;
  ids['agentActor'] = (
    await db
      .insert(actor)
      .values({ organizationId: ids['org'], kind: 'agent', displayName: 'Athena' })
      .returning()
  )[0]!.id;
  ids['agent'] = (
    await db
      .insert(agent)
      .values({ organizationId: ids['org'], actorId: ids['agentActor'] })
      .returning()
  )[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('athena schema additions', () => {
  it('creates the agent_session_transcript and integration_credential tables', async () => {
    for (const table of ['agent_session_transcript', 'integration_credential']) {
      const res = (await db.execute(
        sql`select to_regclass(${`public.${table}`}) as reg`,
      )) as unknown as { rows: { reg: string | null }[] };
      expect(res.rows[0]?.reg, `table ${table} should exist`).not.toBeNull();
    }
  });

  it('defaults agent_session.kind to job and accepts chat', async () => {
    expect(sessionKind.enumValues).toEqual(['chat', 'job']);
    const job = (
      await db
        .insert(agentSession)
        .values({ organizationId: ids['org']!, agentId: ids['agent']!, trigger: 'delegation' })
        .returning()
    )[0]!;
    expect(job.kind).toBe('job');
    expect(job.executorKind).toBe('registered_agent');
    expect(job.ownerUserId).toBeNull();

    const chat = (
      await db
        .insert(agentSession)
        .values({
          organizationId: ids['org']!,
          agentId: ids['agent']!,
          trigger: 'delegation',
          kind: 'chat',
        })
        .returning()
    )[0]!;
    expect(chat.kind).toBe('chat');
    ids['session'] = job.id;
  });

  it('enforces the executor ownership shape at the database boundary', async () => {
    const athena = (
      await db
        .insert(agentSession)
        .values({
          executorKind: 'athena',
          organizationId: null,
          contextOrganizationId: ids['org']!,
          agentId: null,
          ownerUserId: ids['user']!,
          trigger: 'delegation',
          initiatorId: ids['humanActor']!,
        })
        .returning()
    )[0]!;
    expect(athena.ownerUserId).toBe(ids['user']);
    expect(athena.contextOrganizationId).toBe(ids['org']);
    ids['athenaSession'] = athena.id;

    const contextFreeAthena = (
      await db
        .insert(agentSession)
        .values({
          executorKind: 'athena',
          organizationId: null,
          agentId: null,
          ownerUserId: ids['user']!,
          trigger: 'delegation',
        })
        .returning()
    )[0]!;
    ids['contextFreeAthenaSession'] = contextFreeAthena.id;
    expect(contextFreeAthena.contextOrganizationId).toBeNull();

    await expect(
      db.insert(agentSession).values({
        executorKind: 'athena',
        organizationId: null,
        agentId: null,
        ownerUserId: null,
        trigger: 'delegation',
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(agentSession).values({
        executorKind: 'athena',
        organizationId: ids['org']!,
        contextOrganizationId: ids['org']!,
        agentId: null,
        ownerUserId: ids['user']!,
        trigger: 'delegation',
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(agentSession).values({
        executorKind: 'registered_agent',
        organizationId: ids['org']!,
        agentId: ids['agent']!,
        ownerUserId: ids['user']!,
        trigger: 'delegation',
      }),
    ).rejects.toThrow();
  });

  it('persists one idempotent durable run generation for a session', async () => {
    expect(agentSessionRunStatus.enumValues).toEqual([
      'queued',
      'running',
      'waiting',
      'completed',
      'failed',
      'canceled',
    ]);
    const run = (
      await db
        .insert(agentSessionRun)
        .values({
          sessionId: ids['session']!,
          organizationId: ids['org']!,
          generation: 1,
          workflowInstanceId: `${ids['session']!}:1`,
        })
        .returning()
    )[0]!;
    expect(run.status).toBe('queued');
    expect(run.attempt).toBe(0);

    await expect(
      db.insert(agentSessionRun).values({
        sessionId: ids['session']!,
        organizationId: ids['org']!,
        generation: 1,
        workflowInstanceId: `${ids['session']!}:retry`,
      }),
    ).rejects.toThrow();
  });

  it('attributes Athena runs and transcripts to their owning user', async () => {
    const run = (
      await db
        .insert(agentSessionRun)
        .values({
          sessionId: ids['athenaSession']!,
          organizationId: null,
          ownerUserId: ids['user']!,
          generation: 1,
          workflowInstanceId: `${ids['athenaSession']!}:1`,
        })
        .returning()
    )[0]!;
    expect(run.ownerUserId).toBe(ids['user']);

    const transcript = (
      await db
        .insert(agentSessionTranscript)
        .values({
          sessionId: ids['athenaSession']!,
          organizationId: null,
          ownerUserId: ids['user']!,
          messages: [],
        })
        .returning()
    )[0]!;
    expect(transcript.ownerUserId).toBe(ids['user']);

    await expect(
      db.insert(agentSessionRun).values({
        sessionId: ids['athenaSession']!,
        organizationId: ids['org']!,
        ownerUserId: ids['user']!,
        generation: 2,
        workflowInstanceId: `${ids['athenaSession']!}:2`,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(agentSessionTranscript).values({
        sessionId: ids['contextFreeAthenaSession']!,
        organizationId: ids['org']!,
        ownerUserId: ids['user']!,
        messages: [],
      }),
    ).rejects.toThrow();
  });

  it('round-trips a durable transcript of TurnMessages keyed by session', async () => {
    const messages: TurnMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Import my Sunsama backlog.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Reading the source.', signature: 'sig-1' },
          { type: 'tool_use', id: 'toolu_1', name: 'sunsama__get_backlog_tasks', input: {} },
        ],
      },
    ];
    await db.insert(agentSessionTranscript).values({
      sessionId: ids['session']!,
      organizationId: ids['org']!,
      messages,
    });
    const row = (
      await db
        .select()
        .from(agentSessionTranscript)
        .where(eq(agentSessionTranscript.sessionId, ids['session']!))
    )[0]!;
    expect(row.messages).toEqual(messages);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it('stores proposal groups and the executable toolCall on action activities', async () => {
    const body: SessionActivityBody = {
      action: {
        kind: 'create_task',
        summary: 'Create task "Book the venue"',
        toolCall: {
          connection: 'docket',
          tool: 'create_task',
          input: { title: 'Book the venue' },
          toolUseId: 'toolu_2',
        },
        mode: 'proposal',
      },
    };
    const row = (
      await db
        .insert(sessionActivity)
        .values({
          sessionId: ids['session']!,
          organizationId: ids['org']!,
          type: 'action',
          body,
          approvalStatus: 'proposed',
          proposalGroupId: '01HZPROPOSALGROUP000000001',
        })
        .returning()
    )[0]!;
    expect(row.proposalGroupId).toBe('01HZPROPOSALGROUP000000001');
    expect(row.body.action?.toolCall?.tool).toBe('create_task');

    const grouped = await db
      .select()
      .from(sessionActivity)
      .where(eq(sessionActivity.proposalGroupId, '01HZPROPOSALGROUP000000001'));
    expect(grouped).toHaveLength(1);
  });

  it('allows personal activity without workspace attribution', async () => {
    const row = (
      await db
        .insert(sessionActivity)
        .values({
          sessionId: ids['athenaSession']!,
          organizationId: null,
          type: 'response',
          body: { text: 'What should I work on today?' },
        })
        .returning()
    )[0]!;
    expect(row.organizationId).toBeNull();
  });

  it('stores an org-held integration credential 1:1 with its integration', async () => {
    ids['integration'] = (
      await db
        .insert(integration)
        .values({
          organizationId: ids['org']!,
          provider: 'mcp',
          pattern: 'connector',
          config: { url: 'https://mcp.sunsama.com', label: 'Sunsama', alias: 'sunsama' },
        })
        .returning()
    )[0]!.id;
    const cred = (
      await db
        .insert(integrationCredential)
        .values({
          organizationId: ids['org']!,
          integrationId: ids['integration'],
          ciphertext: 'v1:gcm:deadbeef',
        })
        .returning()
    )[0]!;
    expect(cred.ciphertext).toBe('v1:gcm:deadbeef');

    // 1:1 — a second credential row for the same integration is rejected.
    await expect(
      db.insert(integrationCredential).values({
        organizationId: ids['org']!,
        integrationId: ids['integration'],
        ciphertext: 'v1:gcm:other',
      }),
    ).rejects.toThrow();
  });

  it('cascades transcript and credential deletes from their parents', async () => {
    await db.delete(agentSession).where(eq(agentSession.id, ids['session']!));
    const transcripts = await db
      .select()
      .from(agentSessionTranscript)
      .where(eq(agentSessionTranscript.sessionId, ids['session']!));
    expect(transcripts).toHaveLength(0);

    await db.delete(integration).where(eq(integration.id, ids['integration']!));
    const creds = await db
      .select()
      .from(integrationCredential)
      .where(eq(integrationCredential.integrationId, ids['integration']!));
    expect(creds).toHaveLength(0);
  });
});
