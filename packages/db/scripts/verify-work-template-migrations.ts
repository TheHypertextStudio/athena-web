import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { fullSchema } from '../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../src/migrate-work-templates';
import { organization, template } from '../src/schema';
import { seedWorkspaceWorkDefaults } from '../src/seed-statuses';
import { exerciseWorkTemplateMigration } from '../tests/fixtures/work-template-migration';

const connectionString = process.env['WORK_TEMPLATE_PG_URL'];
assert.ok(
  connectionString,
  'Set WORK_TEMPLATE_PG_URL to the isolated local athena_identity_test database.',
);
const target = new URL(connectionString);
assert.ok(
  ['localhost', '127.0.0.1'].includes(target.hostname) &&
    target.pathname === '/athena_identity_test',
  'This verifier resets only the local athena_identity_test database.',
);
const client = postgres(connectionString, { max: 1, prepare: false, onnotice: () => undefined });
const database = drizzle(client, { schema: fullSchema });
try {
  // The explicitly named throwaway database is recreated between verifier runs, never an app DB.
  await client.unsafe(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  const retained = await exerciseWorkTemplateMigration(database, {
    migrationsFolder: resolve(import.meta.dirname, '../drizzle'),
    applySqlMigrations: (folder) => migrate(database, { migrationsFolder: folder }),
  });
  const first = (await database.select({ id: organization.id }).from(organization))[0];
  assert.ok(first);
  const second = (
    await database
      .insert(organization)
      .values({ name: 'Other tenant', slug: 'other-template-tenant' })
      .returning()
  )[0];
  assert.ok(second);
  await seedWorkspaceWorkDefaults(database, second.id);
  const foreign = (await database.select().from(template)).find(
    (row) => row.organizationId === second.id && row.targetType === 'task',
  );
  assert.ok(foreign);
  await client.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'athena_identity_reader') THEN CREATE ROLE athena_identity_reader NOLOGIN; END IF; END $$;
    GRANT USAGE ON SCHEMA public TO athena_identity_reader;
    GRANT SELECT ON template, actor TO athena_identity_reader;
    GRANT SELECT, INSERT ON work_type_version, work_type_team TO athena_identity_reader;`);
  const scoped = async (organizationId: string | null) =>
    client.begin(async (connection) => {
      await connection.unsafe('SET LOCAL ROLE athena_identity_reader');
      if (organizationId)
        await connection`SELECT set_config('docket.organization_id', ${organizationId}, true)`;
      return connection<
        { organization_id: string }[]
      >`SELECT organization_id FROM work_type_version`;
    });
  assert.equal((await scoped(null)).length, 0);
  const own = await scoped(first.id);
  assert.equal(own.length, 5);
  assert.ok(own.every((row) => row.organization_id === first.id));
  const other = await scoped(second.id);
  assert.equal(other.length, 4);
  assert.ok(other.every((row) => row.organization_id === second.id));
  await assert.rejects(
    client.begin(async (connection) => {
      await connection.unsafe('SET LOCAL ROLE athena_identity_reader');
      await connection`SELECT set_config('docket.organization_id', ${first.id}, true)`;
      await connection`INSERT INTO work_type_version (id, organization_id, work_type_id, number, definition)
      VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAX', ${second.id}, ${foreign.id}, 99,
        ${JSON.stringify({ name: 'Foreign write', payload: { targetType: 'task' } })}::jsonb)`;
    }),
    (error: unknown) => error instanceof Error && error.message.includes('row-level security'),
  );
  await migrateWithWorkTemplateCheckpoint(database, {
    migrationsFolder: resolve(import.meta.dirname, '../drizzle'),
    applySqlMigrations: (folder) => migrate(database, { migrationsFolder: folder }),
  });
  console.log(
    'PostgreSQL migration ordering, retained bodies, private/team drafts, interrupted batches, delayed imports, idempotency, enforcement, and restricted-role tenant policies pass.',
    retained,
  );
} finally {
  await client.end();
}
