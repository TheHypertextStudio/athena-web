import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '@docket/db';
import { WorkTemplateCreate, WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { seedTaskAccessOrg, one } from '../support/routes-harness';
import {
  reserveTemplateCopyBundleInTransaction,
  finishTemplateCopyBundleInTransaction,
} from '../../src/lib/templates/copy-reservation';
import { parseCopyBundleAcceptance } from '../../src/lib/templates/copy-reservation-input';
import { appendPublication } from '../../src/lib/templates/persistence';
import { createWorkTemplateInTransaction } from '../../src/lib/templates/creation';
import { serializableTx } from '../../src/lib/serializable-tx';
import type { ActorCtx } from '../../src/context';
import type { TemplateCopyReservation } from '../../src/lib/templates/copy-reservation';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';

const url = process.env['WORK_TEMPLATE_COPY_PG_URL'] ?? '';
const client = postgres(url, { max: 2, prepare: false });
const fingerprint = `sha256:${'1'.repeat(64)}`;
const organizations: string[] = [];
beforeAll(async () => {
  const target = new URL(url);
  expect(target.hostname).toBe('127.0.0.1');
  expect(target.port).toBe('16432');
  expect(target.pathname).toBe('/athena_identity_test');
  expect(process.env['DATABASE_URL']).toBe(url);
  const [version] = await client<
    { version: number }[]
  >`select current_setting('server_version_num')::integer as version`;
  expect(version?.version).toBeGreaterThanOrEqual(180000);
});
afterAll(async () => {
  for (const id of organizations)
    await schema.db.delete(schema.organization).where(eq(schema.organization.id, id));
  await schema.closeDb();
  await client.end();
});
async function fixture() {
  const workspace = await seedTaskAccessOrg(schema.db, schema, 'manage');
  organizations.push(workspace.orgId);
  const user = one(
    await schema.db
      .insert(schema.user)
      .values({ name: 'Concurrent acceptor', email: `${schema.genId()}@copy.test` })
      .returning(),
  );
  await schema.db
    .update(schema.actor)
    .set({ userId: user.id })
    .where(eq(schema.actor.id, workspace.humanActorId));
  const input = parseCopyBundleAcceptance({
    requestId: schema.genId(),
    reviewFingerprint: fingerprint,
    mode: 'private_drafts',
    roots: ['root'],
    entries: [
      {
        key: 'root',
        kind: 'task',
        source: {
          kind: 'catalog',
          release: 1,
          workTypeId: schema.genId(),
          catalogVersionId: schema.genId(),
        },
        sourceFingerprint: fingerprint,
        dependencies: [],
      },
    ],
  });
  return { ...workspace, principal: { organizationId: workspace.orgId, userId: user.id }, input };
}
type CompletedCopy =
  | { kind: 'existing'; id: string | undefined; receipt: string | null }
  | {
      kind: 'reserved';
      id: string;
      receipt: string;
      proof: TemplateCopyReservation;
      actor: ActorCtx;
      reservedId: string | undefined;
    };
async function complete(
  tx: TemplateTransaction,
  reserved: Awaited<ReturnType<typeof reserveTemplateCopyBundleInTransaction>>,
): Promise<CompletedCopy> {
  if (reserved.kind === 'existing')
    return {
      kind: reserved.kind,
      id: reserved.entries[0]?.destinationWorkTypeId,
      receipt: reserved.bundle.receiptKey,
    };
  const proof = reserved.reservations.get('root');
  if (!proof) throw new Error('Missing reserved root');
  const definition = WorkTemplateDefinition.parse({
    name: 'Concurrent private copy',
    payload: { targetType: 'task' },
  });
  const result = await createWorkTemplateInTransaction(
    tx,
    reserved.actor,
    WorkTemplateCreate.parse({ targetType: 'task', scope: 'personal', definition }),
    { identityReservation: proof },
  );
  const receipt = one(
    await tx
      .insert(schema.changeSet)
      .values({
        id: schema.genId(),
        organizationId: reserved.actor.orgId,
        actorId: reserved.actor.actorId,
        origin: { tool: 'copy-test' },
        summary: 'Concurrent copy',
      })
      .returning(),
  );
  await tx.insert(schema.changeSetEntry).values({
    changeSetId: receipt.id,
    entityKind: 'template',
    entityId: result.row.id,
    op: 'create',
    after: { name: result.row.name },
  });
  await finishTemplateCopyBundleInTransaction(tx, proof, {
    receiptId: receipt.id,
    afterStateFingerprints: [{ key: 'root', fingerprint }],
  });
  return {
    kind: reserved.kind,
    id: result.row.id,
    receipt: receipt.id,
    proof,
    actor: reserved.actor,
    reservedId: reserved.entries[0]?.reservedFirstVersionId,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function observeRequestWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await client<
      { waiting: boolean }[]
    >`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like '%pg_advisory_xact_lock%') as waiting`;
    if (row?.waiting) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('Concurrent copy did not observe the actual request lock wait');
}

describe('actual PostgreSQL copy acceptance concurrency', () => {
  it(
    'serializes same-request acceptance and returns one original identity/receipt after retry',
    sameRequest,
  );
  it(
    'keeps a mismatched racing request conflicting without an extra template or receipt',
    mismatchedRequest,
  );
  it(
    'checks exact-TX capabilities and consumes the reserved first identity after a private revision edit',
    checkedCapabilitiesAndPrivateEdit,
  );
});

async function sameRequest(): Promise<void> {
  const f = await fixture(),
    held = deferred(),
    release = deferred();
  const first = serializableTx(async (tx) => {
    const reserved = await reserveTemplateCopyBundleInTransaction(tx, f.principal, f.input);
    held.resolve();
    await release.promise;
    return complete(tx, reserved);
  });
  await held.promise;
  const second = serializableTx(async (tx) =>
    complete(tx, await reserveTemplateCopyBundleInTransaction(tx, f.principal, f.input)),
  );
  try {
    await observeRequestWait();
  } finally {
    release.resolve();
  }
  const results = await Promise.all([first, second]);
  expect(results[0].id).toBe(results[1].id);
  expect(results[0].receipt).toBe(results[1].receipt);
  expect(results.map((result) => result.kind).sort()).toEqual(['existing', 'reserved']);
  expect(
    await schema.db
      .select({ id: schema.workTemplateCopyBundle.id })
      .from(schema.workTemplateCopyBundle)
      .where(eq(schema.workTemplateCopyBundle.organizationId, f.orgId)),
  ).toHaveLength(1);
}

async function mismatchedRequest(): Promise<void> {
  const f = await fixture(),
    held = deferred(),
    release = deferred();
  const first = serializableTx(async (tx) => {
    const reserved = await reserveTemplateCopyBundleInTransaction(tx, f.principal, f.input);
    held.resolve();
    await release.promise;
    return complete(tx, reserved);
  });
  await held.promise;
  const second = serializableTx(async (tx) =>
    complete(
      tx,
      await reserveTemplateCopyBundleInTransaction(tx, f.principal, {
        ...f.input,
        choicesFingerprint: `sha256:${'2'.repeat(64)}`,
      }),
    ),
  );
  const failure = expect(second).rejects.toMatchObject({ status: 409 });
  try {
    await observeRequestWait();
  } finally {
    release.resolve();
  }
  await first;
  await failure;
  expect(
    await schema.db
      .select({ id: schema.workTemplateCopyBundle.id })
      .from(schema.workTemplateCopyBundle)
      .where(eq(schema.workTemplateCopyBundle.organizationId, f.orgId)),
  ).toHaveLength(1);
  expect(
    await schema.db
      .select({ id: schema.changeSet.id })
      .from(schema.changeSet)
      .where(
        and(
          eq(schema.changeSet.organizationId, f.orgId),
          eq(schema.changeSet.actorId, f.humanActorId),
        ),
      ),
  ).toHaveLength(1);
}

async function checkedCapabilitiesAndPrivateEdit(): Promise<void> {
  const f = await fixture();
  const installed = await serializableTx(async (tx) => {
    const reserved = await reserveTemplateCopyBundleInTransaction(tx, f.principal, f.input);
    if (reserved.kind !== 'reserved') throw new Error('Expected new reservation');
    const proof = reserved.reservations.get('root');
    if (!proof) throw new Error('Missing capability');
    const body = WorkTemplateCreate.parse({
      targetType: 'task',
      scope: 'personal',
      definition: WorkTemplateDefinition.parse({
        name: 'Forgery attempt',
        payload: { targetType: 'task' },
      }),
    });
    await expect(
      createWorkTemplateInTransaction(tx, reserved.actor, body, {
        identityReservation: { ...proof },
      }),
    ).rejects.toMatchObject({ status: 403 });
    return complete(tx, reserved);
  });
  if (installed.kind !== 'reserved') throw new Error('Expected accepted capability');
  const { proof, actor, id } = installed;
  const body = WorkTemplateCreate.parse({
    targetType: 'task',
    scope: 'personal',
    definition: WorkTemplateDefinition.parse({
      name: 'Cross transaction attempt',
      payload: { targetType: 'task' },
    }),
  });
  await expect(
    serializableTx((tx) =>
      createWorkTemplateInTransaction(tx, actor, body, { identityReservation: proof }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await serializableTx(async (tx) => {
    const edited = one(
      await tx
        .update(schema.template)
        .set({
          draftRevision: 1,
          draftDefinition: WorkTemplateDefinition.parse({
            name: 'Independent accepted edit',
            payload: { targetType: 'task' },
          }),
        })
        .where(eq(schema.template.id, id))
        .returning(),
    );
    const first = await appendPublication(tx, edited, f.humanActorId);
    expect(first.latestPublishedVersionId).toBe(installed.reservedId);
    expect(first.draftDefinition.name).toBe('Independent accepted edit');
    const second = await appendPublication(tx, first, f.humanActorId);
    expect(second.latestPublishedVersionId).not.toBe(installed.reservedId);
  });
}
