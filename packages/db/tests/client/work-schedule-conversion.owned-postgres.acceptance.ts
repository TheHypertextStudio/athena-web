import { resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { exerciseScheduleConversionPreparation } from '../fixtures/work-schedule-conversion';

it('proves fresh/populated normal migration and immutable nonexecuting preparation on owned PostgreSQL', async () => {
  const expected = process.env['DOCKET_SCHEDULE_POSTGRES_DATABASE'];
  if (expected !== 'history_oct25_b2')
    throw new Error('Use the owned conversion PostgreSQL database');
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Supply the dedicated owned PostgreSQL database');
  expect(new URL(url).pathname).toBe('/' + expected);
  const client = postgres(url, { max: 3, prepare: false, onnotice: () => undefined });
  const database = drizzle(client, { schema: fullSchema });
  try {
    expect((await client`select current_database() as name`)[0]?.['name']).toBe(expected);
    console.log((await client`select version()`)[0]?.['version']);
    const options = {
      migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
      applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
    };
    await exerciseScheduleConversionPreparation(database, options);
    expect(
      (await client`select count(*)::integer as count from drizzle.__drizzle_migrations`)[0]?.[
        'count'
      ],
    ).toBe(176);
    expect(
      (
        await client`select count(*)::integer as count from process_occurrence where accepted_claim is not null`
      )[0]?.['count'],
    ).toBe(0);
    await verifyPrivateRole(client);
  } finally {
    await client.end();
  }
});

async function verifyPrivateRole(client: ReturnType<typeof postgres>): Promise<void> {
  await client.unsafe(
    'DO $$ BEGIN CREATE ROLE history_oct25_conversion_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT USAGE ON SCHEMA public TO history_oct25_conversion_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO history_oct25_conversion_reader',
  );
  const [source] =
    await client`select d.organization_id,d.created_by as actor_id from process_definition d join recurrence_series s on s.definition_id=d.id limit 1`;
  if (!source) throw new Error('Missing private conversion workspace');
  const organizationId = String(source['organization_id']),
    actorId = String(source['actor_id']);
  const count = async (actor: string, organization = organizationId) =>
    client.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE history_oct25_conversion_reader');
      await tx`select set_config('docket.organization_id',${organization},true),set_config('docket.actor_id',${actor},true)`;
      return Number(
        (
          await tx`select count(*)::integer as count from recurrence_series_revision where conversion_receipt is not null`
        )[0]?.['count'],
      );
    });
  expect(await count('unrelated-stranger')).toBe(0);
  await client`insert into "grant"(id,organization_id,subject_kind,subject_id,resource_kind,resource_id,capabilities,effect) values('history-conversion-owner-view',${organizationId},'actor',${actorId},'organization',${organizationId},'["view"]'::jsonb,'allow')`;
  expect(await count(actorId)).toBe(0);
  await client`update "grant" set capabilities='["view","manage"]'::jsonb where id='history-conversion-owner-view'`;
  expect(await count(actorId)).toBe(6);
  expect(await count(actorId, 'foreign-tenant')).toBe(0);
  await client`update "grant" set capabilities='[]'::jsonb where id='history-conversion-owner-view'`;
  expect(await count(actorId)).toBe(0);
}
