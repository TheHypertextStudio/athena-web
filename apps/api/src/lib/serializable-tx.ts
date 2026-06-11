import { db } from '@docket/db';

import { ConflictError } from '../error';

/**
 * Postgres SQLSTATE codes that indicate a transaction was rolled back due to a
 * serialization conflict or deadlock, and is safe to retry.
 *
 * @remarks
 * `40001` = serialization_failure; `40P01` = deadlock_detected. Under SERIALIZABLE,
 * two concurrent edge inserts that would jointly close a cycle each pass their own
 * reachability check, but one is aborted at commit with `40001` — re-running it
 * re-reads the now-committed edge and the acyclic guard rejects it (data-model §7.4).
 */
const SERIALIZATION_RETRY_CODES = new Set(['40001', '40P01']);

/** Whether a thrown error is a retryable serialization/deadlock failure (by SQLSTATE). */
function isSerializationFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof err.code === 'string' &&
    SERIALIZATION_RETRY_CODES.has((err as { code: string }).code)
  );
}

/**
 * Run a SERIALIZABLE transaction, retrying a bounded number of times when Postgres
 * aborts it with a serialization/deadlock failure (SQLSTATE 40001/40P01).
 *
 * @remarks
 * SERIALIZABLE is what makes the acyclic reachability check sound under concurrency
 * (data-model §7.4 step 3): READ COMMITTED lets two requests inserting `A→B` and
 * `B→A` each pass the cycle guard and both commit, producing a 2-cycle. The loser
 * of a SERIALIZABLE conflict is aborted with `40001`; we retry it (re-reading the
 * committed edge, which the guard then rejects) and, if the conflict persists past
 * the retry budget, surface a {@link ConflictError} the client can retry.
 *
 * @param fn - The transaction body.
 * @throws {ConflictError} When the transaction still cannot be serialized after retries.
 */
export async function serializableTx<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(fn, { isolationLevel: 'serializable' });
    } catch (err) {
      /* v8 ignore start -- @preserve concurrency boundary: SQLSTATE 40001/40P01 only
         arises under concurrent writers on real Postgres; PGlite is single-connection,
         so the retry + give-up branches can't be hit deterministically in tests. */
      if (isSerializationFailure(err) && attempt < maxAttempts) continue;
      if (isSerializationFailure(err)) {
        throw new ConflictError('Concurrent update conflict, please retry');
      }
      /* v8 ignore stop */
      throw err;
    }
  }
}
