/**
 * `@docket/api` — the `Idempotency-Key` middleware.
 *
 * @remarks
 * `POST` is the one unsafe method HTTP gives no retry story for: a client that loses the
 * response to `POST /tasks` cannot know whether the task was created, and both choices are
 * wrong — retrying duplicates it, giving up loses it. The `Idempotency-Key` header resolves
 * that by making the *request* the unit of deduplication: the first attempt under a key runs
 * and has its outcome recorded, and every later attempt under the same key replays that
 * recorded outcome instead of executing again.
 *
 * This closes a contract the API had already published without implementing. The
 * `idempotency_key` table (`@docket/db`, data-model §8), the `idempotency_key_reuse` problem
 * code, and the Scalar reference's "creates accept an `Idempotency-Key` header" promise all
 * predate this middleware; until it existed a client that followed the documentation got no
 * deduplication at all and no error telling it so.
 *
 * Scope and semantics:
 *
 * - Only `POST` is covered. `GET`/`PUT`/`PATCH`/`DELETE` are already idempotent or safe by
 *   method definition, so a key would add bookkeeping and no guarantee.
 * - Keys are scoped per user, so one caller's key can never replay another's response.
 * - The stored request fingerprint is `method + path + body`. Replaying a key against a
 *   *different* request is a client bug, not a retry, and gets `422 idempotency_key_reuse`
 *   rather than the earlier response.
 * - Records expire after 24 hours, which bounds the table and matches the window in which a
 *   retry is still meaningful.
 * - Only JSON responses are recorded. Streaming and binary handlers have no body worth
 *   replaying, so they pass through unprotected rather than being buffered into memory.
 *
 * @see `docs/engineering/specs/rest-conventions.md` §"Retry safety".
 */
import { createHash } from 'node:crypto';

import { db, idempotencyKey } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { AppEnv } from '../context';
import { ConflictError, IdempotencyConflictError } from '../error';

/** How long a recorded outcome stays replayable. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Marks a response that was replayed from an earlier attempt rather than freshly computed. */
const REPLAY_HEADER = 'Idempotency-Replayed';

/** The key ownership established before an idempotent route begins its write. */
export interface IdempotencyClaim {
  /** The authenticated account that owns the retry key. */
  readonly userId: string;
  /** The exact caller-provided retry key. */
  readonly key: string;
}

/** The successful response a route can commit beside its domain mutation. */
export interface AtomicIdempotencyResult {
  /** The workspace the mutation belongs to, when the route is workspace-scoped. */
  readonly organizationId: string | null;
  /** The HTTP success status replayed to later attempts. */
  readonly responseStatus: number;
  /** The validated JSON body replayed to later attempts. */
  readonly responseBody: unknown;
}

/**
 * Complete a claimed retry key through the transaction that commits the domain mutation.
 *
 * @param database - The active domain transaction.
 * @param claim - The retry key claimed by {@link idempotency}.
 * @param result - The validated response to persist for later replay.
 * @throws When the claim disappeared or was completed by another writer.
 */
export async function completeIdempotencyInTransaction(
  database: Pick<typeof db, 'update'>,
  claim: IdempotencyClaim,
  result: AtomicIdempotencyResult,
): Promise<void> {
  const completed = await database
    .update(idempotencyKey)
    .set({
      organizationId: result.organizationId,
      status: 'completed',
      responseStatus: result.responseStatus,
      responseBody: result.responseBody,
    })
    .where(
      and(
        eq(idempotencyKey.userId, claim.userId),
        eq(idempotencyKey.key, claim.key),
        eq(idempotencyKey.status, 'in_progress'),
      ),
    )
    .returning({ key: idempotencyKey.key });
  if (completed.length !== 1) {
    throw new ConflictError('The idempotent request claim is no longer active');
  }
}

/** A stable fingerprint of the request a key was first used for. */
function fingerprint(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method}\n${path}\n${body}`).digest('base64url');
}

/**
 * Deduplicate retried `POST`s that carry an `Idempotency-Key`.
 *
 * @remarks
 * Requests without the header are untouched, so this is purely opt-in and costs an
 * un-keyed request nothing but a header lookup.
 *
 * The key is claimed with an `ON CONFLICT DO NOTHING` insert, which is what makes two
 * simultaneous retries safe: exactly one of them writes the row and proceeds, and the loser
 * sees an `in_progress` record and gets `409` rather than executing the same create twice.
 * A row is only left `in_progress` if the process died mid-request; it expires with the rest.
 */
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('Idempotency-Key');
  const userId = c.get('session')?.user.id;
  if (c.req.method !== 'POST' || key === undefined || key === '' || userId === undefined) {
    return next();
  }

  const path = new URL(c.req.url).pathname;
  const hash = fingerprint(c.req.method, path, await c.req.raw.clone().text());

  const claimed = await db
    .insert(idempotencyKey)
    .values({
      userId,
      key,
      method: c.req.method,
      path,
      requestHash: hash,
      status: 'in_progress',
      expiresAt: new Date(Date.now() + RETENTION_MS),
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKey.key });

  if (claimed.length === 0) {
    const rows = await db
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)))
      .limit(1);
    const prior = rows[0];
    // Gone between the failed insert and this read (expired and swept): treat the key as
    // fresh rather than failing a caller who did nothing wrong.
    if (!prior) return next();
    if (prior.requestHash !== hash) throw new IdempotencyConflictError();
    if (prior.status === 'in_progress' || prior.responseStatus === null) {
      throw new ConflictError('An earlier request with this key is still in flight');
    }
    c.header(REPLAY_HEADER, 'true');
    // Only the status and body are recorded, so a replayed `201` carries no `Location`. It is
    // tempting to rebuild one from the request path and the body's `id`, and that is wrong:
    // `created()` takes an explicit location precisely because some resources do not live below
    // the collection posted to — a subtask created through `POST /tasks/{id}/subtasks` is
    // addressed at `/tasks/{newId}` — so the derivation would hand a retrying client a URL that
    // matches no route, and none at all for a body without a top-level `id`. An absent header is
    // a smaller lie than a fabricated one; recording the real one needs a column this table has
    // not got.
    return c.json(prior.responseBody, prior.responseStatus as ContentfulStatusCode);
  }

  c.set('idempotencyClaim', { userId, key });

  await next();

  if (c.get('idempotencyCompleted') === true) return;

  // Only a completed JSON response is worth replaying. A failure is not recorded at all, so
  // the key stays usable: retrying a create that 500ed is exactly what the header is for.
  const isJson = c.res.headers.get('Content-Type')?.includes('application/json') ?? false;
  if (c.res.status < 400 && isJson) {
    await db
      .update(idempotencyKey)
      .set({
        status: 'completed',
        responseStatus: c.res.status,
        responseBody: await c.res.clone().json(),
      })
      .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)));
    return;
  }
  await db
    .delete(idempotencyKey)
    .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)));
};
