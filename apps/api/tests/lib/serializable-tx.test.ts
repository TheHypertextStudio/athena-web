/**
 * `@docket/api` — retry-on-serialization-conflict wrapper (`lib/serializable-tx.ts`).
 *
 * @remarks
 * PGlite is single-connection, so a real SQLSTATE 40001/40P01 can't be produced in
 * tests — `@docket/db`'s `db.transaction` is mocked instead, thrown with error shapes
 * matching what Drizzle actually surfaces (a wrapped error with the real SQLSTATE
 * nested at `err.cause.code`, not `err.code`), rather than relying on real concurrency.
 * `db` itself is a Proxy (for `db.query.*`), so `vi.spyOn(db, 'transaction')` can't see
 * an own property descriptor to spy on — the whole module is mocked instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@docket/db', () => ({ db: { transaction } }));

import { ConflictError } from '../../src/error';
import { serializableTx } from '../../src/lib/serializable-tx';

/** A Drizzle-wrapped driver error: `.code` is undefined, the real SQLSTATE is on `.cause.code`. */
function wrappedSqlStateError(code: string): Error & { cause: { code: string } } {
  return Object.assign(new Error('query failed'), { cause: { code } });
}

afterEach(() => {
  transaction.mockReset();
});

describe('serializableTx', () => {
  it('retries a wrapped serialization-failure (40001) and succeeds once the conflict clears', async () => {
    transaction.mockRejectedValueOnce(wrappedSqlStateError('40001')).mockResolvedValueOnce('ok');

    await expect(serializableTx(async () => 'unused')).resolves.toBe('ok');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('retries a wrapped deadlock (40P01) the same way', async () => {
    transaction.mockRejectedValueOnce(wrappedSqlStateError('40P01')).mockResolvedValueOnce('ok');

    await expect(serializableTx(async () => 'unused')).resolves.toBe('ok');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and surfaces a ConflictError', async () => {
    transaction.mockRejectedValue(wrappedSqlStateError('40001'));

    await expect(serializableTx(async () => 'unused')).rejects.toBeInstanceOf(ConflictError);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry and rethrows immediately for a non-serialization error', async () => {
    const other = new Error('not a serialization failure');
    transaction.mockRejectedValueOnce(other);

    await expect(serializableTx(async () => 'unused')).rejects.toBe(other);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
