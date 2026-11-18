import { resolve } from 'node:path';

import { db, jwks } from '@docket/db';
import { symmetricEncrypt } from 'better-auth/crypto';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { pruneUndecryptableJwks } from '../src/jwks-recovery';

const CURRENT_SECRET = 'current-production-secret-at-least-32-chars';
const PREVIOUS_SECRET = 'previous-rotated-secret-at-least-32-chars';

beforeAll(async () => {
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
  });
});

afterEach(async () => {
  await db.delete(jwks);
});

describe('pruneUndecryptableJwks', () => {
  it('deletes rows encrypted with a rotated secret and preserves valid rows', async () => {
    const staleCipher = await symmetricEncrypt({
      key: PREVIOUS_SECRET,
      data: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', d: 'stale' }),
    });
    const validCipher = await symmetricEncrypt({
      key: CURRENT_SECRET,
      data: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', d: 'valid' }),
    });

    await db.insert(jwks).values([
      {
        id: 'jwks-stale',
        publicKey: '{"kty":"OKP"}',
        privateKey: JSON.stringify(staleCipher),
        createdAt: new Date(),
      },
      {
        id: 'jwks-valid',
        publicKey: '{"kty":"OKP"}',
        privateKey: JSON.stringify(validCipher),
        createdAt: new Date(),
      },
    ]);

    const pruned = await pruneUndecryptableJwks(CURRENT_SECRET);
    const remaining = await db.select({ id: jwks.id }).from(jwks);

    expect(pruned).toBe(1);
    expect(remaining).toEqual([{ id: 'jwks-valid' }]);
  });
});
