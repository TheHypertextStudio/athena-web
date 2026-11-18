import { db, jwks } from '@docket/db';
import { env } from '@docket/env/api';
import { symmetricDecrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

/**
 * Remove stored Better Auth JWKS rows whose private key cannot be decrypted with the active
 * `BETTER_AUTH_SECRET`, allowing Better Auth to mint a fresh keypair after secret rotation.
 *
 * @param secret - Override secret for tests; defaults to `env.BETTER_AUTH_SECRET`.
 * @returns The number of undecryptable JWKS rows deleted.
 */
export async function pruneUndecryptableJwks(
  secret: string = env.BETTER_AUTH_SECRET,
): Promise<number> {
  const rows = await db.select({ id: jwks.id, privateKey: jwks.privateKey }).from(jwks);
  let pruned = 0;

  for (const row of rows) {
    try {
      const parsed: unknown = JSON.parse(row.privateKey);
      if (typeof parsed !== 'string') {
        throw new Error('Unexpected JWKS privateKey payload shape');
      }
      await symmetricDecrypt({ key: secret, data: parsed });
    } catch {
      await db.delete(jwks).where(eq(jwks.id, row.id));
      pruned += 1;
    }
  }

  return pruned;
}
