/** Atomic request receipts for MCP comment and update calls. */
import { createHash } from 'node:crypto';
import { mcpContentReceipt, db, genId } from '@docket/db';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { ConflictError, IdempotencyConflictError } from '../error';
import { hasSqlState } from '../lib/sql-state';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const RETENTION_MS = 48 * 60 * 60 * 1000;

/** Stable fingerprint for one already-validated MCP tool input.
 * @param value - The parsed tool input whose property order is schema-stable.
 * @returns The SHA-256 fingerprint encoded as base64url.
 */
export function contentRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

/** Read and validate a previous key inside the transaction that would otherwise create the post.
 * @param tx - The active transaction that will create or replay the post.
 * @param input - The caller, operation, key, and expected input fingerprint.
 * @returns The committed post id, or `null` when this request has no receipt yet.
 * @throws {IdempotencyConflictError} When the key was reused with different input.
 */
export async function readMcpContentReceipt(
  tx: Transaction,
  input: {
    readonly organizationId: string;
    readonly callerKey: string;
    readonly toolName: string;
    readonly requestId?: string | undefined;
    readonly requestHash: string;
  },
): Promise<string | null> {
  if (!input.requestId) return null;
  const [receipt] = await tx
    .select()
    .from(mcpContentReceipt)
    .where(
      and(
        eq(mcpContentReceipt.organizationId, input.organizationId),
        eq(mcpContentReceipt.callerKey, input.callerKey),
        eq(mcpContentReceipt.toolName, input.toolName),
        eq(mcpContentReceipt.requestId, input.requestId),
      ),
    )
    .limit(1);
  if (!receipt) return null;
  if (receipt.expiresAt <= new Date()) {
    await tx.delete(mcpContentReceipt).where(eq(mcpContentReceipt.id, receipt.id));
    return null;
  }
  if (receipt.requestHash !== input.requestHash) throw new IdempotencyConflictError();
  return receipt.postId;
}

/** Save the replay key in the same transaction as the newly created comment or update.
 * @param tx - The transaction that created the post.
 * @param input - The receipt identity and committed post id.
 * @throws {ConflictError} When another request has already claimed the same key.
 */
export async function saveMcpContentReceipt(
  tx: Transaction,
  input: {
    readonly organizationId: string;
    readonly callerKey: string;
    readonly toolName: string;
    readonly requestId?: string | undefined;
    readonly requestHash: string;
    readonly postId: string;
  },
): Promise<void> {
  if (!input.requestId) return;
  try {
    await tx.insert(mcpContentReceipt).values({
      id: genId(),
      organizationId: input.organizationId,
      callerKey: input.callerKey,
      toolName: input.toolName,
      requestId: input.requestId,
      requestHash: input.requestHash,
      postId: input.postId,
      expiresAt: new Date(Date.now() + RETENTION_MS),
    });
  } catch (error) {
    if (!hasSqlState(error, '23505')) throw error;
    throw new ConflictError(
      'A request with this retry key is already being saved. Retry the same request.',
    );
  }
}

/** Return the receipt owner without storing account names or credentials.
 * @param input - The verified actor, principal, and optional MCP client identity.
 * @returns A stable, non-secret namespace for the caller's receipts.
 */
export function mcpReceiptCallerKey(input: {
  readonly actorId: string;
  readonly principal:
    | { readonly kind: 'user'; readonly userId: string }
    | { readonly kind: 'agent'; readonly agentId: string };
  readonly clientId?: string | null | undefined;
}): string {
  return JSON.stringify([
    input.actorId,
    input.principal.kind,
    input.principal.kind === 'user' ? input.principal.userId : input.principal.agentId,
    input.clientId ?? null,
  ]);
}

/** Remove a bounded batch of MCP retry receipts beyond their replay window.
 * @param now - The expiry cutoff; defaults to the current time.
 * @param limit - The maximum number of receipts to remove.
 * @returns The number of receipts removed.
 */
export async function sweepExpiredMcpContentReceipts(
  now = new Date(),
  limit = 500,
): Promise<number> {
  const rows = await db
    .select({ id: mcpContentReceipt.id })
    .from(mcpContentReceipt)
    .where(lte(mcpContentReceipt.expiresAt, now))
    .orderBy(asc(mcpContentReceipt.expiresAt), asc(mcpContentReceipt.id))
    .limit(limit);
  if (rows.length === 0) return 0;
  await db.delete(mcpContentReceipt).where(
    inArray(
      mcpContentReceipt.id,
      rows.map((row) => row.id),
    ),
  );
  return rows.length;
}
