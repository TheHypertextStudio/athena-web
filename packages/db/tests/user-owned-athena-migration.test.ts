import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../drizzle');
const migrationName = '0041_user_owned_athena.sql';
const clients: PGlite[] = [];

function migrationSql(through: string): string {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql') && file <= through)
    .sort()
    .map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8'))
    .join('\n');
}

async function legacyDatabase(): Promise<PGlite> {
  const client = new PGlite('memory://');
  clients.push(client);
  await client.exec(migrationSql('0040_pink_franklin_storm.sql'));
  await client.exec(`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES ('user_owner', 'Owner', 'owner@example.com', true);
    INSERT INTO organization (id, name, slug)
    VALUES ('org_one', 'Workspace', 'workspace');
    INSERT INTO actor (id, organization_id, kind, display_name, user_id)
    VALUES
      ('actor_owner', 'org_one', 'human', 'Owner', 'user_owner'),
      ('actor_athena', 'org_one', 'agent', 'Athena', null);
    INSERT INTO agent (id, organization_id, actor_id)
    VALUES ('agent_athena', 'org_one', 'actor_athena');
  `);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('user-owned Athena migration', () => {
  it('ships the next ordered migration', () => {
    expect(readdirSync(migrationsFolder)).toContain(migrationName);
  });

  it('maps only unambiguous legacy Athena jobs to their initiating user', async () => {
    const client = await legacyDatabase();
    await client.exec(`
      INSERT INTO agent_session
        (id, organization_id, agent_id, trigger, kind, initiator_id)
      VALUES
        ('session_owned', 'org_one', 'agent_athena', 'delegation', 'job', 'actor_owner'),
        ('session_ambiguous', 'org_one', 'agent_athena', 'mention', 'job', null),
        ('session_shared_chat', 'org_one', 'agent_athena', 'delegation', 'chat', 'actor_owner');
      INSERT INTO agent_session_run
        (id, session_id, organization_id, generation, workflow_instance_id)
      VALUES ('run_owned', 'session_owned', 'org_one', 1, 'workflow_owned');
      INSERT INTO agent_session_transcript (session_id, organization_id, messages)
      VALUES
        ('session_owned', 'org_one', '[]'),
        ('session_shared_chat', 'org_one', '[]');
    `);

    await client.exec(readFileSync(resolve(migrationsFolder, migrationName), 'utf8'));

    const sessions = await client.query<{
      id: string;
      executor_kind: string;
      organization_id: string | null;
      owner_user_id: string | null;
      agent_id: string | null;
      context_organization_id: string | null;
    }>(`
      SELECT id, executor_kind, organization_id, owner_user_id, agent_id, context_organization_id
      FROM agent_session
      ORDER BY id
    `);
    expect(sessions.rows).toEqual([
      {
        id: 'session_ambiguous',
        executor_kind: 'registered_agent',
        organization_id: 'org_one',
        owner_user_id: null,
        agent_id: 'agent_athena',
        context_organization_id: null,
      },
      {
        id: 'session_owned',
        executor_kind: 'athena',
        organization_id: null,
        owner_user_id: 'user_owner',
        agent_id: null,
        context_organization_id: 'org_one',
      },
      {
        id: 'session_shared_chat',
        executor_kind: 'registered_agent',
        organization_id: 'org_one',
        owner_user_id: null,
        agent_id: 'agent_athena',
        context_organization_id: null,
      },
    ]);

    const runs = await client.query<{ owner_user_id: string | null }>(
      `SELECT owner_user_id FROM agent_session_run WHERE id = 'run_owned'`,
    );
    expect(runs.rows[0]?.owner_user_id).toBe('user_owner');
    const transcripts = await client.query<{ session_id: string; owner_user_id: string | null }>(
      `SELECT session_id, owner_user_id FROM agent_session_transcript ORDER BY session_id`,
    );
    expect(transcripts.rows).toEqual([
      { session_id: 'session_owned', owner_user_id: 'user_owner' },
      { session_id: 'session_shared_chat', owner_user_id: null },
    ]);
  });
});
