import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { openPglite } from '../../src/client';
import { main } from '../../src/migrate';

const copyMigrations = [
  '0166_work_template_copy_reservations.sql',
  '0167_work_template_copy_reference_integrity.sql',
].map((file) =>
  readFileSync(resolve(import.meta.dirname, '../../drizzle', file), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim()),
);

/** Execute the shipped role boundary against an isolated PostgreSQL catalog. */
async function withCopyRole(
  verify: (client: ReturnType<typeof openPglite>) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'docket-copy-role-migrate-'));
  const client = openPglite(`pglite://${dir}`);
  try {
    await client.exec(`CREATE ROLE copy_migration_owner NOLOGIN CREATEROLE;
      GRANT USAGE,CREATE ON SCHEMA public TO copy_migration_owner;
      SET ROLE copy_migration_owner`);
    const createRole = copyMigrations[0]?.find((statement) =>
      statement.includes("'Unsafe preexisting copy integrity role'"),
    );
    if (!createRole) throw new Error('Copy role creation guard is missing');
    await client.exec(createRole);
    await verify(client);
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

it('accepts the non-superuser creator admin grant after revoking temporary copy-owner access', async () => {
  await withCopyRole(async (client) => {
    for (const statements of copyMigrations) {
      for (const statement of statements) {
        if (
          statement.startsWith('GRANT docket_template_copy_integrity TO CURRENT_USER') ||
          statement.startsWith('REVOKE docket_template_copy_integrity FROM CURRENT_USER') ||
          statement.includes("'Copy integrity role prerequisites are not satisfied'") ||
          statement.includes("'Copy integrity role cleanup is not satisfied'")
        ) {
          await client.exec(statement);
        }
      }
    }
    const actual = await client.query<{
      admin_option: boolean;
      inherit_option: boolean;
      set_option: boolean;
      bootstrap_grantor: boolean;
    }>(`SELECT m.admin_option,m.inherit_option,m.set_option,m.grantor=10 AS bootstrap_grantor
      FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      WHERE r.rolname='docket_template_copy_integrity'`);
    expect(actual.rows).toEqual([
      { admin_option: true, inherit_option: false, set_option: false, bootstrap_grantor: true },
    ]);
  });
});

it.each([
  ['login', 'ALTER ROLE docket_template_copy_integrity LOGIN'],
  [
    'inheritance',
    'GRANT docket_template_copy_integrity TO CURRENT_USER WITH INHERIT TRUE, SET FALSE',
  ],
  [
    'role switching',
    'GRANT docket_template_copy_integrity TO CURRENT_USER WITH INHERIT FALSE, SET TRUE',
  ],
  [
    'another administrator',
    `CREATE ROLE copy_other NOLOGIN;
    GRANT docket_template_copy_integrity TO copy_other WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
  ],
  [
    'another superuser grantor',
    `RESET ROLE;
    CREATE ROLE copy_other_superuser NOLOGIN SUPERUSER;
    GRANT docket_template_copy_integrity TO copy_other_superuser WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    SET ROLE copy_other_superuser;
    GRANT docket_template_copy_integrity TO copy_migration_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE GRANTED BY CURRENT_USER;
    SET ROLE copy_migration_owner`,
  ],
  [
    'indirect runtime access',
    `CREATE ROLE copy_other NOLOGIN;
    GRANT docket_template_copy_integrity TO copy_other WITH INHERIT TRUE, SET TRUE;
    GRANT copy_other TO CURRENT_USER`,
  ],
  [
    'outbound membership',
    `CREATE ROLE copy_parent NOLOGIN;
    GRANT copy_parent TO docket_template_copy_integrity WITH INHERIT FALSE, SET FALSE`,
  ],
])('rejects copy integrity %s at every shipped role boundary', async (_name, mutation) => {
  await withCopyRole(async (client) => {
    await client.exec(mutation);
    for (const statements of copyMigrations) {
      for (const statement of statements) {
        if (
          statement.includes("'Unsafe preexisting copy integrity role'") ||
          statement.includes("'Copy integrity role prerequisites are not satisfied'") ||
          statement.includes("'Copy integrity role cleanup is not satisfied'")
        ) {
          await expect(client.exec(statement)).rejects.toMatchObject({ code: 'P0001' });
        }
      }
    }
  });
});

it('applies copy storage through the real canonical PGlite runner and preserves its journal on reentry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docket-copy-canonical-migrate-'));
  const url = `pglite://${dir}`;
  vi.stubEnv('DATABASE_URL', url);
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
  try {
    await main();
    const client = openPglite(url);
    let before: unknown;
    try {
      const journal = await client.query<{ hash: string; created_at: string }>(
        'select hash,created_at from drizzle.__drizzle_migrations order by id',
      );
      before = journal.rows;
      const manifest = JSON.parse(
        readFileSync(resolve(import.meta.dirname, '../../drizzle/meta/_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };
      const expectedHashes = manifest.entries.map(({ tag }) =>
        createHash('sha256')
          .update(readFileSync(resolve(import.meta.dirname, '../../drizzle', `${tag}.sql`)))
          .digest('hex'),
      );
      expect(journal.rows.map((row) => row.hash)).toEqual(expectedHashes);
      const actual = await client.query<{ epoch: boolean; guard: boolean }>(
        `select exists(select 1 from information_schema.columns where table_name='work_template_copy_entry' and column_name='reference_epoch') as epoch,exists(select 1 from pg_proc where proname='docket_copy_bundle_member_in_use') as guard`,
      );
      expect(actual.rows).toEqual([{ epoch: true, guard: true }]);
    } finally {
      await client.close();
    }
    await main();
    const reopened = openPglite(url);
    try {
      expect(
        (
          await reopened.query(
            'select hash,created_at from drizzle.__drizzle_migrations order by id',
          )
        ).rows,
      ).toEqual(before);
    } finally {
      await reopened.close();
    }
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
