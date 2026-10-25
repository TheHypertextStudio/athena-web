import { beforeAll, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import {
  getPrivatePublicationDb as getDb,
  seedPrivatePublicationActor,
} from '../support/private-publication-fixture';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import { rawResultRows } from '../../src/lib/raw-result';
import './private-definition-source-denial.postgres.acceptance';
vi.mock('../support/db', () => ({ getMigratedDb: async () => await import('@docket/db') }));
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function fixture() {
  return seedPrivatePublicationActor(schema.db, schema);
}
async function origin(id: string) {
  return rawResultRows<{ origin: string | null }>(
    await schema.db.execute(
      sql`select identity_origin as origin from work_template_invocation_head where id=${id}`,
    ),
  )[0]?.origin;
}
it('reserves actual retained identity, rejects origin forgery and preserves the reservation until lawful whole-tenant purge', async () => {
  const f = await fixture(),
    id = schema.genId();
  await schema.db.insert(schema.processDefinition).values({
    id,
    organizationId: f.orgId,
    createdBy: f.humanActorId,
    name: 'Retained original',
    status: 'draft',
  });
  expect(await origin(id)).toBe('retained');
  await expect(
    schema.db.execute(
      sql`update work_template_invocation_head set identity_origin='authored',revision=revision+1 where id=${id}`,
    ),
  ).rejects.toThrow();
  await expect(
    schema.db.delete(schema.invocationHead).where(eq(schema.invocationHead.id, id)),
  ).rejects.toThrow();
  await expect(
    schema.db.insert(schema.invocationHead).values({
      id,
      organizationId: f.orgId,
      ownerActorId: f.humanActorId,
      name: 'Forged original',
    }),
  ).rejects.toThrow();
  await expect(
    schema.db.execute(
      sql`insert into work_template_invocation_head(id,organization_id,owner_actor_id,created_by,name,identity_origin) values(${schema.genId()},${f.orgId},${f.humanActorId},${f.humanActorId},'Invented original','retained')`,
    ),
  ).rejects.toThrow();
  await schema.db.delete(schema.organization).where(eq(schema.organization.id, f.orgId));
  expect(await origin(id)).toBeUndefined();
});
it('denies raw readiness receipt writes even when the nonsuperuser has ordinary table grants', async () => {
  const f = await fixture();
  await schema.db.transaction(async (tx) => {
    await tx.execute(sql.raw('SET LOCAL ROLE history_oct25_authored_restricted'));
    await tx.execute(
      sql`select set_config('docket.organization_id',${f.orgId},true),set_config('docket.actor_id',${f.humanActorId},true)`,
    );
    const [role] = rawResultRows<{ superuser: boolean; bypass: boolean }>(
      await tx.execute(
        sql`select rolsuper as superuser,rolbypassrls as bypass from pg_roles where rolname=current_user`,
      ),
    );
    expect(role).toEqual({ superuser: false, bypass: false });
    expect(
      rawResultRows(await tx.execute(sql`select * from work_template_identity_namespace`)),
    ).toHaveLength(0);
    expect(
      rawResultRows(
        await tx.execute(
          sql`update work_template_identity_namespace set coverage_hash='sha256:forged' returning singleton`,
        ),
      ),
    ).toHaveLength(0);
    expect(
      rawResultRows<{ ready: boolean }>(
        await tx.execute(sql`select docket_private_identity_namespace_ready() as ready`),
      )[0]?.ready,
    ).toBe(true);
  });
});
async function awaitLock(tag: string): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const [row] = rawResultRows<{ blocked: boolean }>(
      await schema.db.execute(
        sql`select exists(select 1 from pg_stat_activity where application_name=${tag} and wait_event_type='Lock') as blocked`,
      ),
    );
    if (row?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The identity contender did not reach its database lock.');
}
async function collision(winnerKind: 'retained' | 'authored'): Promise<void> {
  const f = await fixture(),
    id = schema.genId(),
    tag = `identity_${id}`;
  let acquired!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    }),
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
  const insert = async (tx: DbModule.Database, kind: 'retained' | 'authored') => {
    if (kind === 'retained')
      await tx.insert(schema.processDefinition).values({
        id,
        organizationId: f.orgId,
        createdBy: f.humanActorId,
        name: 'Original identity',
      });
    else
      await tx.insert(schema.invocationHead).values({
        id,
        organizationId: f.orgId,
        ownerActorId: f.humanActorId,
        name: 'Authored identity',
      });
  };
  const winner = schema.db.transaction(async (tx) => {
    await insert(tx, winnerKind);
    acquired();
    await hold;
  });
  await ready;
  const loser = schema.db
    .transaction(async (tx) => {
      await tx.execute(sql`select set_config('application_name',${tag},true)`);
      await insert(tx, winnerKind === 'retained' ? 'authored' : 'retained');
    })
    .then(
      () => ({ accepted: true, error: null }),
      (error: unknown) => ({ accepted: false, error }),
    );
  try {
    await awaitLock(tag);
  } finally {
    release();
  }
  await winner;
  const rejected = await loser;
  expect(rejected.accepted).toBe(false);
  expect(rejected.error).toMatchObject({
    cause: { code: '23505', constraint_name: 'work_template_invocation_head_pkey' },
  });
  expect(await origin(id)).toBe(winnerKind);
  const sources = await schema.db
    .select()
    .from(schema.processDefinition)
    .where(eq(schema.processDefinition.id, id));
  expect(sources).toHaveLength(winnerKind === 'retained' ? 1 : 0);
}
it('serializes a normalized source reservation winning the same proposed authored identity', async () =>
  collision('retained'));
it('serializes an authored identity winning against the same proposed normalized source', async () =>
  collision('authored'));

it('retains actual original alias registration for a genuine normalized publication during identity expansion', async () => {
  const f = await fixture();
  const published = await createPublishedProcessDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition: ProcessDefinitionCreate.parse({
      name: 'Retained publication compatibility',
      tasks: [{ key: 'original', title: 'Original Task', teamId: f.teamId }],
    }),
  });
  expect(await origin(published.definitionId)).toBe('retained');
  await schema.backfillInvocationRevisionAliases(schema.db, { batchSize: 1 });
  const aliases = await schema.db
    .select()
    .from(schema.invocationRevision)
    .where(eq(schema.invocationRevision.id, published.revisionId));
  expect(aliases).toHaveLength(1);
  expect(aliases[0]).toMatchObject({ origin: 'retained', authoredPayloadHash: null });
  expect(aliases[0]?.originalSourceFingerprint).toMatch(/^[a-f0-9]{32}$/);
  const heads = await schema.db
    .select()
    .from(schema.invocationHead)
    .where(eq(schema.invocationHead.id, published.definitionId));
  expect(heads[0]?.canonicalAuthoringAt).toBeInstanceOf(Date);
});
