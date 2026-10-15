import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { getDb } from '../support/routes-harness';
import { retainedFixture } from './work-template-adapter-fixture';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function helpers() {
  return import('../../src/lib/work-creation/retained-authority');
}

describe('persisted retained occurrence authority', () => {
  it('binds exact selection and run date to the actual active persisted creator', async () => {
    const f = await retainedFixture(schema);
    const { authorizeRetainedOccurrence, requireRetainedOccurrenceAuthority } = await helpers();
    await schema.db.transaction(async (tx) => {
      const checked = await authorizeRetainedOccurrence(tx, f.request);
      expect(checked.caller.actorId).toBe(f.humanActorId);
      expect(checked.runDate).toBe('2026-10-14');
      expect(checked.manifest.roots[0]).toMatchObject({
        workTypeId: f.published.id,
        workTypeVersionId: f.published.latestPublishedVersionId,
      });
      expect(requireRetainedOccurrenceAuthority(tx, checked.authority)).toBe(checked);
      expect(() => requireRetainedOccurrenceAuthority(tx, { ...checked.authority })).toThrow();
    });
  });
  it('refuses transaction reuse and foreign occurrence pointers without private metadata', async () => {
    const f = await retainedFixture(schema);
    const other = await retainedFixture(schema);
    const { authorizeRetainedOccurrence, requireRetainedOccurrenceAuthority } = await helpers();
    const checked = await schema.db.transaction((tx) => authorizeRetainedOccurrence(tx, f.request));
    await expect(
      schema.db.transaction(async (tx) =>
        requireRetainedOccurrenceAuthority(tx, checked.authority),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      schema.db.transaction((tx) =>
        authorizeRetainedOccurrence(tx, { ...f.request, occurrenceId: other.occurrence.id }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('preserves a truly nullable creator through the existing checked recurrence authority', async () => {
    const f = await retainedFixture(schema);
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ createdBy: null })
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    const { authorizeRetainedOccurrence } = await helpers();
    const checked = await schema.db.transaction((tx) => authorizeRetainedOccurrence(tx, f.request));
    expect(checked.caller).toMatchObject({
      kind: 'retained-recurrence',
      actorId: null,
      binding: { seriesId: f.series.id, revisionId: f.seriesRevision.id },
    });
  });
  it('refuses pending drafts even if an old public materialization call names the revision', async () => {
    const f = await retainedFixture(schema, true);
    const { authorizeRetainedOccurrence } = await helpers();
    await expect(
      schema.db.transaction((tx) => authorizeRetainedOccurrence(tx, f.request)),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('refuses a private manifest that changes the original source key or omits its override', async () => {
    const { authorizeRetainedOccurrence } = await helpers();
    for (const invalid of ['key', 'overrides'] as const) {
      const f = await retainedFixture(schema, false, invalid);
      await expect(
        schema.db.transaction((tx) => authorizeRetainedOccurrence(tx, f.request)),
      ).rejects.toMatchObject({ status: 409 });
    }
  });
  it('retains lawful archived-root binding but rejects a suspended creator rather than fabricating one', async () => {
    const f = await retainedFixture(schema);
    await schema.db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, f.published.id));
    const { authorizeRetainedOccurrence } = await helpers();
    const checked = await schema.db.transaction((tx) => authorizeRetainedOccurrence(tx, f.request));
    expect(checked.manifest.roots[0]?.workTypeVersionId).toBe(f.published.latestPublishedVersionId);
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, f.humanActorId));
    await expect(
      schema.db.transaction((tx) => authorizeRetainedOccurrence(tx, f.request)),
    ).rejects.toMatchObject({ status: 404 });
  });
});
