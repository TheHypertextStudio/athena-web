/**
 * `time/share` — the one deliberate, revocable path by which anything outside a session can read
 * what its owner is tracking.
 *
 * @remarks
 * "Put a widget on my personal website showing what task I'm working on" is a legitimate wish
 * and a dangerous default. It is implemented here as a *credential*, not a visibility flag: the
 * owner mints a token, the token grants exactly one question ("what now?"), and revoking it ends
 * the grant. No route in this module can reach a timeline, a total, a second task, or a
 * historical segment, so an accidentally-leaked token leaks one sentence about one moment.
 *
 * Only a SHA-256 hash of the token is stored, so the database cannot be read back into a working
 * share link, and comparison is done on the hash rather than the raw value.
 */
import { createHash, randomBytes } from 'node:crypto';

import { db, hub, organization, task, timeInterval, timeRecord, timeShareToken } from '@docket/db';
import type { PublicTimerStatusOut, TimeShareTokenCreate, TimeShareTokenOut } from '@docket/types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { AuthError, NotFoundError } from '../error';
import { resolveTimeHubId } from './access';
import { measureIntervals } from './read-models';

type TimeShareTokenInput = z.input<typeof TimeShareTokenOut>;
type PublicTimerStatusInput = z.input<typeof PublicTimerStatusOut>;

/** How many random bytes back one share token. */
const SHARE_TOKEN_BYTES = 24;

/** The header a widget presents its token in. */
export const SHARE_TOKEN_HEADER = 'x-docket-share-token';

/**
 * Hash a raw share token for storage and lookup.
 *
 * @remarks
 * SHA-256 without a salt is correct here and a mistake for passwords. A share token is 192 bits
 * of `randomBytes`, so there is no dictionary to attack and no cost parameter worth paying on a
 * lookup that a public widget performs on every poll. What the hash buys is that a database read
 * yields nothing usable.
 *
 * @param raw - The token as presented by a caller.
 * @returns the hex-encoded digest stored in `time_share_token.token_hash`.
 */
export function hashShareToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Serialize a stored token for its owner, never including the secret. */
function toShareTokenOut(row: typeof timeShareToken.$inferSelect): TimeShareTokenInput {
  return {
    id: row.id,
    label: row.label,
    includeTitle: row.includeTitle,
    includeWorkspace: row.includeWorkspace,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** List the caller's share tokens, newest first. */
export async function listTimeShareTokens(userId: string): Promise<TimeShareTokenInput[]> {
  const hubId = await resolveTimeHubId(userId);
  const rows = await db
    .select()
    .from(timeShareToken)
    .where(eq(timeShareToken.hubId, hubId))
    .orderBy(desc(timeShareToken.createdAt));
  return rows.map(toShareTokenOut);
}

/** A minted token plus the one-time secret its owner must copy now. */
export interface MintedShareToken {
  readonly stored: TimeShareTokenInput;
  readonly token: string;
}

/** Mint one revocable current-task share token. */
export async function createTimeShareToken(
  userId: string,
  input: TimeShareTokenCreate,
): Promise<MintedShareToken> {
  const hubId = await resolveTimeHubId(userId);
  const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
  const rows = await db
    .insert(timeShareToken)
    .values({
      hubId,
      userId,
      tokenHash: hashShareToken(token),
      label: input.label,
      includeTitle: input.includeTitle,
      includeWorkspace: input.includeWorkspace,
    })
    .returning();
  const row = rows[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('share token insert returned no row');
  return { stored: toShareTokenOut(row), token };
}

/**
 * Revoke one token.
 *
 * @remarks
 * The row is marked rather than deleted so the owner keeps a record of what they once shared and
 * when it was last read — a share that vanishes without trace is a share you cannot audit.
 */
export async function revokeTimeShareToken(
  userId: string,
  id: string,
): Promise<TimeShareTokenInput> {
  const hubId = await resolveTimeHubId(userId);
  const rows = await db
    .update(timeShareToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(timeShareToken.id, id), eq(timeShareToken.hubId, hubId)))
    .returning();
  const row = rows[0];
  if (!row) throw new NotFoundError('Share token not found');
  return toShareTokenOut(row);
}

/**
 * Answer the one question an external page may ask.
 *
 * @remarks
 * An unknown or revoked token is a 401 — the same answer for both, so probing cannot distinguish
 * "never existed" from "was turned off". A valid token with nothing running is a *successful*
 * `idle` response, because a widget that shows "not working right now" is the point, and an error
 * there would make a quiet evening look like a broken integration.
 *
 * @param rawToken - The token exactly as the caller presented it.
 * @returns the permitted view of the owner's current tracking.
 * @throws {AuthError} When the token is unknown or revoked.
 */
export async function readSharedTimerStatus(rawToken: string): Promise<PublicTimerStatusInput> {
  const now = new Date();
  const grants = await db
    .select()
    .from(timeShareToken)
    .where(
      and(eq(timeShareToken.tokenHash, hashShareToken(rawToken)), isNull(timeShareToken.revokedAt)),
    )
    .limit(1);
  const grant = grants[0];
  if (!grant) throw new AuthError('Share token is not valid');
  await db.update(timeShareToken).set({ lastUsedAt: now }).where(eq(timeShareToken.id, grant.id));

  const hubRows = await db.select({ id: hub.id }).from(hub).where(eq(hub.id, grant.hubId)).limit(1);
  /* v8 ignore next -- @preserve the FK makes an orphaned grant unrepresentable */
  if (!hubRows[0]) throw new AuthError('Share token is not valid');

  // The newest record that is still open or paused IS the current session. A closed record is
  // finished work, not "what I'm doing", so it never answers this question.
  //
  // Left-joined because a running session may not be anchored to a task yet. An inner join dropped
  // those rows entirely, so a shared status page reported "idle" while its owner was demonstrably
  // tracking — the one thing the page exists to get right. An unanchored session reports its state
  // with a null title, which is also what a viewer without `includeTitle` already sees.
  const sessions = await db
    .select({ record: timeRecord, taskTitle: task.title, workspaceName: organization.name })
    .from(timeRecord)
    .leftJoin(task, eq(task.id, timeRecord.taskId))
    .leftJoin(organization, eq(organization.id, task.organizationId))
    .where(and(eq(timeRecord.hubId, grant.hubId), eq(timeRecord.createdByUserId, grant.userId)))
    .orderBy(desc(timeRecord.startedAt))
    .limit(20);
  const current = sessions.find(
    (row) => row.record.status === 'open' || row.record.status === 'paused',
  );
  if (!current) {
    return {
      state: 'idle',
      taskTitle: null,
      workspaceName: null,
      startedAt: null,
      elapsedMs: 0,
      serverNow: now.toISOString(),
    };
  }
  const intervals = await db
    .select()
    .from(timeInterval)
    .where(
      and(eq(timeInterval.timeRecordId, current.record.id), isNull(timeInterval.supersededById)),
    );
  const measures = measureIntervals(intervals, now);
  return {
    state: current.record.status === 'open' ? 'running' : 'paused',
    taskTitle: grant.includeTitle ? (current.taskTitle ?? null) : null,
    workspaceName: grant.includeWorkspace ? (current.workspaceName ?? null) : null,
    startedAt: current.record.startedAt?.toISOString() ?? null,
    elapsedMs: measures.humanEffortMs,
    serverNow: now.toISOString(),
  };
}
