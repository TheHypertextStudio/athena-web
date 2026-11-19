import { resolve } from 'node:path';

import { db, twoFactor, user } from '@docket/db';
import { symmetricEncrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getRecoveryCodeStatus, hasRecoveryCodes } from '../src/backup-codes';

const USER_ID = 'user-backup-code-rotation-test';
const PREVIOUS_SECRET = 'previous-rotated-secret-at-least-32-chars';

beforeAll(async () => {
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
  });
});

afterEach(async () => {
  await db.delete(twoFactor).where(eq(twoFactor.userId, USER_ID));
  await db.delete(user).where(eq(user.id, USER_ID));
});

describe('recovery code resilience after secret rotation', () => {
  it('returns null status and false hasRecoveryCodes when stored codes cannot be decrypted', async () => {
    const now = new Date();
    await db.insert(user).values({
      id: USER_ID,
      name: 'Rotated User',
      email: 'rotated@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });

    const staleEncrypted = await symmetricEncrypt({
      key: PREVIOUS_SECRET,
      data: JSON.stringify(['abcde-12345']),
    });
    await db.insert(twoFactor).values({
      id: 'tf-rotated-1',
      userId: USER_ID,
      secret: 'stale-secret',
      backupCodes: staleEncrypted,
      backupCodesGeneratedAt: now,
    });

    await expect(getRecoveryCodeStatus(USER_ID)).resolves.toBeNull();
    await expect(hasRecoveryCodes(USER_ID)).resolves.toBe(false);
  });
});
