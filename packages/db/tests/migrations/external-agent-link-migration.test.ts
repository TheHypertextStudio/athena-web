import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationPath = resolve(
  import.meta.dirname,
  '../../drizzle/0108_external_agent_interoperability.sql',
);
const clients: PGlite[] = [];

async function databaseBeforeMigration(): Promise<PGlite> {
  const client = new PGlite('memory://');
  clients.push(client);
  await client.exec(`
    CREATE TABLE agent_session_external_link (
      session_id text PRIMARY KEY,
      organization_id text NOT NULL,
      provider text NOT NULL,
      external_session_id text NOT NULL,
      external_workspace_id text NOT NULL,
      external_issue_id text,
      last_relayed_activity_id text,
      last_relayed_activity_updated_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('external agent link migration', () => {
  it('preserves the linked work item while adding relay state', async () => {
    const client = await databaseBeforeMigration();
    await client.exec(`
      INSERT INTO agent_session_external_link (
        session_id,
        organization_id,
        provider,
        external_session_id,
        external_workspace_id,
        external_issue_id
      ) VALUES ('session-1', 'org-1', 'linear', 'linear-session-1', 'linear-workspace-1', 'issue-1');
    `);

    await client.exec(readFileSync(migrationPath, 'utf8'));

    const result = await client.query<{
      external_work_item_id: string;
      relay_status: string;
      relay_attempts: number;
      next_relay_at: Date | null;
      last_relay_error: string | null;
    }>(`
      SELECT external_work_item_id, relay_status, relay_attempts, next_relay_at, last_relay_error
      FROM agent_session_external_link
      WHERE session_id = 'session-1'
    `);
    expect(result.rows).toEqual([
      {
        external_work_item_id: 'issue-1',
        relay_status: 'pending',
        relay_attempts: 0,
        next_relay_at: null,
        last_relay_error: null,
      },
    ]);
  });

  it('prevents two Athena sessions from claiming one provider session', async () => {
    const client = await databaseBeforeMigration();
    await client.exec(readFileSync(migrationPath, 'utf8'));
    await client.exec(`
      INSERT INTO agent_session_external_link (
        session_id,
        organization_id,
        provider,
        external_session_id,
        external_workspace_id
      ) VALUES ('session-1', 'org-1', 'slack', 'channel-1:thread-1', 'team-1');
    `);

    await expect(
      client.exec(`
        INSERT INTO agent_session_external_link (
          session_id,
          organization_id,
          provider,
          external_session_id,
          external_workspace_id
        ) VALUES ('session-2', 'org-1', 'slack', 'channel-1:thread-1', 'team-1');
      `),
    ).rejects.toThrow();
  });

  it('rejects invalid retry state', async () => {
    const client = await databaseBeforeMigration();
    await client.exec(readFileSync(migrationPath, 'utf8'));

    await expect(
      client.exec(`
        INSERT INTO agent_session_external_link (
          session_id,
          organization_id,
          provider,
          external_session_id,
          external_workspace_id,
          relay_status,
          relay_attempts
        ) VALUES ('session-1', 'org-1', 'github', 'repo#1', 'installation-1', 'unknown', -1);
      `),
    ).rejects.toThrow();
  });
});
