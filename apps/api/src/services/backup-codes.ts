/**
 * Backup codes service for account recovery.
 *
 * @packageDocumentation
 */

import { randomBytes, createHash } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { backupCodes } from '../db/schema/auth.js';

/** Number of backup codes to generate per user */
const BACKUP_CODE_COUNT = 10;

/** Length of each backup code (characters) */
const BACKUP_CODE_LENGTH = 8;

/**
 * Generate a random backup code.
 * Format: XXXX-XXXX (alphanumeric, uppercase)
 */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding similar chars (0, O, 1, I)
  const bytes = randomBytes(BACKUP_CODE_LENGTH);
  let code = '';

  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    const byteValue = bytes[i];
    if (byteValue !== undefined) {
      const charIndex = byteValue % chars.length;
      const char = chars.charAt(charIndex);
      code += char;
    }
  }

  // Format as XXXX-XXXX
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Hash a backup code for storage.
 * Uses SHA-256 for fast verification.
 */
function hashCode(code: string): string {
  // Normalize: remove dashes and uppercase
  const normalized = code.replace(/-/g, '').toUpperCase();
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Generate new backup codes for a user.
 * This invalidates all existing unused codes.
 *
 * @returns Array of plain text codes to show to user (only time they'll see them)
 */
export async function generateBackupCodes(userId: string): Promise<string[]> {
  // Delete all existing backup codes for this user
  await db.delete(backupCodes).where(eq(backupCodes.userId, userId));

  // Generate new codes
  const codes: string[] = [];
  const codeRecords: {
    id: string;
    userId: string;
    codeHash: string;
  }[] = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = generateCode();
    codes.push(code);
    codeRecords.push({
      id: `bc_${randomBytes(12).toString('hex')}`,
      userId,
      codeHash: hashCode(code),
    });
  }

  // Insert all codes
  await db.insert(backupCodes).values(codeRecords);

  return codes;
}

/**
 * Verify a backup code for account recovery.
 * If valid, marks the code as used.
 *
 * @returns true if code is valid and unused, false otherwise
 */
export async function verifyBackupCode(userId: string, code: string): Promise<boolean> {
  const codeHash = hashCode(code);

  // Find matching unused code
  const [matchingCode] = await db
    .select()
    .from(backupCodes)
    .where(
      and(
        eq(backupCodes.userId, userId),
        eq(backupCodes.codeHash, codeHash),
        isNull(backupCodes.usedAt),
      ),
    )
    .limit(1);

  if (!matchingCode) {
    return false;
  }

  // Mark code as used
  await db
    .update(backupCodes)
    .set({ usedAt: new Date() })
    .where(eq(backupCodes.id, matchingCode.id));

  return true;
}

/**
 * Get the count of remaining (unused) backup codes for a user.
 */
export async function getRemainingBackupCodesCount(userId: string): Promise<number> {
  const codes = await db
    .select()
    .from(backupCodes)
    .where(and(eq(backupCodes.userId, userId), isNull(backupCodes.usedAt)));

  return codes.length;
}

/**
 * Check if a user has any backup codes generated.
 */
export async function hasBackupCodes(userId: string): Promise<boolean> {
  const [code] = await db.select().from(backupCodes).where(eq(backupCodes.userId, userId)).limit(1);

  return !!code;
}

/**
 * Get backup codes info (for display in settings).
 */
export async function getBackupCodesInfo(userId: string): Promise<{
  hasBackupCodes: boolean;
  remainingCount: number;
  totalCount: number;
  generatedAt: Date | null;
}> {
  const codes = await db.select().from(backupCodes).where(eq(backupCodes.userId, userId));

  if (codes.length === 0) {
    return {
      hasBackupCodes: false,
      remainingCount: 0,
      totalCount: 0,
      generatedAt: null,
    };
  }

  const unusedCodes = codes.filter((c) => !c.usedAt);
  const oldestCode = codes.reduce((oldest, code) =>
    code.createdAt < oldest.createdAt ? code : oldest,
  );

  return {
    hasBackupCodes: true,
    remainingCount: unusedCodes.length,
    totalCount: codes.length,
    generatedAt: oldestCode.createdAt,
  };
}
