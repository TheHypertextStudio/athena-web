/** Run the owning retry scenarios against the migrated loopback PostgreSQL 18 database. */
import { afterAll, beforeAll, expect, vi } from 'vitest';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@docket/db';
import type * as TestDatabase from '../support/db';
import type * as RouteHarness from '../support/routes-harness';

const fixtures = vi.hoisted(() => ({ organizations: new Set<string>() }));

// The normal suite bootstrap installs a PGlite snapshot. This acceptance file uses the real
// postgres driver selected by DATABASE_URL while keeping all owning route scenarios identical.
vi.mock('../support/db', async (importOriginal) => {
  const actual = await importOriginal<typeof TestDatabase>();
  return { ...actual, getMigratedDb: async () => await import('@docket/db') };
});
vi.mock('../support/routes-harness', async (importOriginal) => {
  const actual = await importOriginal<typeof RouteHarness>();
  return {
    ...actual,
    seedTaskAccessOrg: async (...args: Parameters<typeof actual.seedTaskAccessOrg>) => {
      const fixture = await actual.seedTaskAccessOrg(...args);
      fixtures.organizations.add(fixture.orgId);
      return fixture;
    },
  };
});

const url = process.env['WORK_TEMPLATE_COPY_PG_URL'] ?? '';
const target = new URL(url);
if (
  target.hostname !== '127.0.0.1' ||
  target.port !== '16432' ||
  target.pathname !== '/athena_identity_test'
)
  throw new Error('Retry acceptance requires the disposable loopback identity test database.');
if (process.env['DATABASE_URL'] !== url)
  throw new Error('Retry acceptance requires DATABASE_URL to match WORK_TEMPLATE_COPY_PG_URL.');
const control = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });

beforeAll(async () => {
  const [server] = await control<{ version: number }[]>`
    select current_setting('server_version_num')::integer as version
  `;
  expect(server?.version).toBeGreaterThanOrEqual(180000);
});

afterAll(async () => {
  const organizations = [...fixtures.organizations];
  const actors = organizations.length
    ? await schema.db
        .select({ userId: schema.actor.userId })
        .from(schema.actor)
        .where(inArray(schema.actor.organizationId, organizations))
    : [];
  const users = actors.flatMap(({ userId }) => (userId ? [userId] : []));
  if (users.length)
    await schema.db
      .delete(schema.apiIdempotencyReceipt)
      .where(inArray(schema.apiIdempotencyReceipt.userId, users));
  for (const id of organizations)
    await schema.db.delete(schema.organization).where(eq(schema.organization.id, id));
  if (users.length) await schema.db.delete(schema.user).where(inArray(schema.user.id, users));
  await schema.closeDb();
  await control.end();
});

import './recurrence-creation-retry.test';
import './process-definition-creation-retry.test';
