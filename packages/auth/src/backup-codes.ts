/**
 * `@docket/auth` — generate and read a user's recovery (backup) codes.
 *
 * @remarks
 * Recovery codes are stored exactly as the `twoFactor` plugin's `verifyBackupCode` reads them: a
 * single encrypted JSON array in `two_factor.backup_codes` (`storeBackupCodes: 'encrypted'`), one
 * code removed per recovery. We own generation here — rather than the client calling the plugin's
 * RPC `enable`/`generate-backup-codes` endpoints — so Docket's API exposes recovery codes as a
 * proper REST resource (`GET`/`POST /v1/me/recovery-codes`). Generation reuses Better Auth's own
 * `symmetricEncrypt` (same primitive, same key) so the bytes stay compatible with the plugin's
 * verify path; reads decode the blob with `symmetricDecrypt`. Both avoid casting around the
 * plugin's endpoints, which `buildAuthOptions` erases from the statically-typed `auth.api`.
 */
import { randomBytes, randomInt } from 'node:crypto';

import { db, twoFactor as twoFactorTable, user as userTable } from '@docket/db';
import { env } from '@docket/env/api';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

/** How many recovery codes a generation produces. */
const CODE_COUNT = 10;
/** Characters a recovery code is drawn from (matches the plugin's `a-z 0-9 A-Z` alphabet). */
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A single `xxxxx-xxxxx` recovery code drawn unbiasedly from {@link CODE_ALPHABET}. */
function makeCode(): string {
  let s = '';
  for (let i = 0; i < 10; i += 1) s += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/**
 * Whether a user has recovery codes set up (a `two_factor` row exists).
 *
 * @param userId - The user to check.
 * @returns `true` when the user has generated recovery codes.
 *
 * @remarks
 * The cheap, no-decrypt gate — the single source of truth for "can this user recover", shared by
 * the `recovery-challenge` endpoint (decide whether to arm a challenge) so it doesn't read the
 * plugin-added `user.twoFactorEnabled` flag through a cast. Row existence is exactly what
 * `verifyBackupCode` needs (it looks the same row up), so it cannot diverge from "recovery works".
 */
export async function hasRecoveryCodes(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: twoFactorTable.id })
    .from(twoFactorTable)
    .where(eq(twoFactorTable.userId, userId))
    .limit(1);
  return row !== undefined;
}

/** A user's recovery-code status: how many remain and when they were last generated. */
export interface RecoveryCodeStatus {
  /** Unused recovery codes remaining. */
  readonly remaining: number;
  /** ISO-8601 instant the codes were last (re)generated. */
  readonly generatedAt: string;
}

/**
 * Read a user's recovery-code status (remaining count + last-generated time).
 *
 * @param userId - The user whose codes to read.
 * @returns the {@link RecoveryCodeStatus}, or `null` when the user has never generated any
 *   (no `two_factor` row) — letting callers distinguish "no codes" from "0 codes left".
 *
 * @remarks
 * Codes are stored encrypted (`storeBackupCodes: 'encrypted'`) under the Better Auth secret. The
 * env contract exposes only a single `BETTER_AUTH_SECRET` (no key-rotation `secrets` /
 * `BETTER_AUTH_SECRETS` knob), so the encryption key is exactly `BETTER_AUTH_SECRET` — Better Auth
 * sets `secretConfig = secret` in that case (see its `create-context`). If a rotation knob is ever
 * added to the env contract, revisit this decrypt key. The decrypted codes never leave this
 * function; only the count crosses the boundary.
 */
export async function getRecoveryCodeStatus(userId: string): Promise<RecoveryCodeStatus | null> {
  const [row] = await db
    .select({
      backupCodes: twoFactorTable.backupCodes,
      generatedAt: twoFactorTable.backupCodesGeneratedAt,
    })
    .from(twoFactorTable)
    .where(eq(twoFactorTable.userId, userId))
    .limit(1);
  if (!row) return null;

  const decrypted = await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: row.backupCodes });
  const codes: unknown = JSON.parse(decrypted);
  return {
    remaining: Array.isArray(codes) ? codes.length : 0,
    generatedAt: row.generatedAt.toISOString(),
  };
}

/**
 * Generate a fresh set of recovery codes for a user, replacing any existing set.
 *
 * @param userId - The user to (re)generate codes for.
 * @returns the plaintext codes — shown to the user once and never retrievable again.
 *
 * @remarks
 * Powers `POST /v1/me/recovery-codes`. Encrypts the codes under `BETTER_AUTH_SECRET` exactly as the
 * `twoFactor` plugin stores them, so its `verifyBackupCode` consumes them unchanged during recovery.
 * Upserts the single `two_factor` row (replacing the previous codes), stamps
 * `backupCodesGeneratedAt`, and flips `user.twoFactorEnabled` — all in one transaction. The
 * `secret` column is required by the plugin schema but unused here (TOTP is disabled), so it holds
 * an encrypted random value to mirror the plugin's row shape.
 */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: CODE_COUNT }, makeCode);
  const encryptedCodes = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: JSON.stringify(codes),
  });
  const now = new Date();

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: twoFactorTable.id })
      .from(twoFactorTable)
      .where(eq(twoFactorTable.userId, userId))
      .limit(1);
    if (existing) {
      await tx
        .update(twoFactorTable)
        .set({ backupCodes: encryptedCodes, backupCodesGeneratedAt: now })
        .where(eq(twoFactorTable.id, existing.id));
    } else {
      const secret = await symmetricEncrypt({
        key: env.BETTER_AUTH_SECRET,
        data: randomBytes(20).toString('base64url'),
      });
      await tx.insert(twoFactorTable).values({
        secret,
        backupCodes: encryptedCodes,
        userId,
        backupCodesGeneratedAt: now,
      });
    }
    await tx.update(userTable).set({ twoFactorEnabled: true }).where(eq(userTable.id, userId));
  });

  return codes;
}
