/**
 * `@docket/api` — reading and saving personal composer drafts.
 *
 * @remarks
 * Every draft read or write from the `/v1/me/drafts` router goes through here. A draft belongs
 * to one user; nothing in this module ever returns another user's row, and a missing, foreign, or
 * expired id is a `NotFoundError` either way.
 *
 * Saves are optimistic: a save names the revision it was written against and is refused with
 * `412 precondition_failed` when the row has moved on, which is what lets two open tabs autosave
 * the same draft without one silently overwriting the other. Every save renews the expiry.
 */
import { composerDraft, db } from '@docket/db';
import {
  COMPOSER_DRAFT_TTL_DAYS,
  composerDraftTitle,
  type ComposerDraftCreate,
  type ComposerDraftListQuery,
  type ComposerDraftOut,
  type ComposerDraftPatch,
} from '@docket/work/composer-draft-contract';
import { and, desc, eq, gt, sql, type SQL } from 'drizzle-orm';

import { NotFoundError, PreconditionFailedError, ValidationError } from '../../error';
import { ownerActorInOrg } from '../plan-draft/store';

/** A stored composer draft. */
export type ComposerDraftRow = typeof composerDraft.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The expiry a save made at `now` sets. */
export function composerDraftExpiry(now: Date): Date {
  return new Date(now.getTime() + COMPOSER_DRAFT_TTL_DAYS * DAY_MS);
}

/** The conditions for rows the caller may still see: theirs, and not yet expired. */
function ownedLiveFilters(ownerUserId: string, now: Date): SQL[] {
  return [eq(composerDraft.ownerUserId, ownerUserId), gt(composerDraft.expiresAt, now)];
}

/** Load a draft the caller owns that has not expired, or 404. */
export async function loadOwnedDraft(ownerUserId: string, id: string): Promise<ComposerDraftRow> {
  const rows = await db
    .select()
    .from(composerDraft)
    .where(and(eq(composerDraft.id, id), ...ownedLiveFilters(ownerUserId, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Draft not found');
  return row;
}

/** The caller's unexpired drafts, most recently saved first, narrowed by the query. */
export async function listOwnedDrafts(
  ownerUserId: string,
  query: ComposerDraftListQuery,
): Promise<ComposerDraftRow[]> {
  const filters = ownedLiveFilters(ownerUserId, new Date());
  if (query.kind !== undefined) filters.push(eq(composerDraft.kind, query.kind));
  if (query.organizationId !== undefined) {
    filters.push(eq(composerDraft.organizationId, query.organizationId));
  }
  return db
    .select()
    .from(composerDraft)
    .where(and(...filters))
    .orderBy(desc(composerDraft.updatedAt));
}

/**
 * Save a new draft in a workspace the caller belongs to.
 *
 * @throws {NotFoundError} When the caller is not a member of the workspace.
 */
export async function createDraft(
  ownerUserId: string,
  body: ComposerDraftCreate,
): Promise<ComposerDraftRow> {
  const actorId = await ownerActorInOrg(ownerUserId, body.organizationId);
  if (actorId === null) throw new NotFoundError('Workspace not found');
  const inserted = await db
    .insert(composerDraft)
    .values({
      ownerUserId,
      organizationId: body.organizationId,
      kind: body.kind,
      payload: body.payload,
      expiresAt: composerDraftExpiry(new Date()),
    })
    .returning();
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('composer draft insert returned no row');
  return row;
}

/**
 * Replace a draft's payload against the revision it was read at, and renew its expiry.
 *
 * @throws {PreconditionFailedError} When the draft's revision has moved on.
 * @throws {ValidationError} When the payload describes a different composer than the draft.
 * @throws {NotFoundError} When the draft is missing, expired, or not the caller's.
 */
export async function patchDraft(
  ownerUserId: string,
  id: string,
  patch: ComposerDraftPatch,
): Promise<ComposerDraftRow> {
  await loadOwnedDraft(ownerUserId, id);
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(composerDraft)
      .where(eq(composerDraft.id, id))
      .for('update')
      .limit(1);
    const row = locked[0];
    if (!row) throw new NotFoundError('Draft not found');
    if (row.revision !== patch.revision) {
      throw new PreconditionFailedError('The draft changed since that revision.');
    }
    if (patch.payload.kind !== row.kind) {
      throw new ValidationError([
        {
          message: 'The payload must describe the same composer the draft belongs to.',
          path: ['payload', 'kind'],
        },
      ]);
    }
    // `updatedAt` orders the list, so it is stamped from the database clock like the insert
    // default is; a JS `Date` would truncate to the millisecond and could sort a save behind a
    // row inserted in the same instant.
    const updated = await tx
      .update(composerDraft)
      .set({
        payload: patch.payload,
        revision: row.revision + 1,
        updatedAt: sql`now()`,
        expiresAt: composerDraftExpiry(new Date()),
      })
      .where(eq(composerDraft.id, id))
      .returning();
    const next = updated[0];
    /* v8 ignore next -- @preserve defensive: update always returns a row */
    if (!next) throw new Error('composer draft update returned no row');
    return next;
  });
}

/**
 * Remove a draft the caller owns.
 *
 * @throws {NotFoundError} When the draft is missing, expired, or not the caller's.
 */
export async function deleteDraft(ownerUserId: string, id: string): Promise<void> {
  const row = await loadOwnedDraft(ownerUserId, id);
  await db.delete(composerDraft).where(eq(composerDraft.id, row.id));
}

/** The draft as the API returns it, with the list title derived from the payload. */
export function presentDraft(row: ComposerDraftRow): ComposerDraftOut {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    revision: row.revision,
    payload: row.payload,
    title: composerDraftTitle(row.payload),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  } as ComposerDraftOut;
}
