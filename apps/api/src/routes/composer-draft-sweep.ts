/**
 * `@docket/api` — the expired composer-draft cleanup sweep.
 *
 * @remarks
 * A saved composer draft carries an `expiresAt` that every save renews, and reads already leave
 * an expired row out (`lib/composer-draft/store.ts`), so this sweep only reclaims storage. A plain,
 * stateless delete: an expired row has no live state to race or double-process, so no lease or
 * claim guard is needed the way the in-flight sweeps in this directory use one.
 */
import { composerDraft, db } from '@docket/db';
import { lte } from 'drizzle-orm';

/** The outcome of one sweep tick. */
export interface ComposerDraftSweepResult {
  /** Expired draft rows deleted this tick. */
  readonly deleted: number;
}

/** Delete every composer draft whose `expiresAt` has passed. */
export async function sweepExpiredComposerDrafts(now: Date): Promise<ComposerDraftSweepResult> {
  const deleted = await db
    .delete(composerDraft)
    .where(lte(composerDraft.expiresAt, now))
    .returning({ id: composerDraft.id });
  return { deleted: deleted.length };
}
