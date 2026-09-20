/**
 * `@docket/api` — the `Idempotency-Key` middleware.
 *
 * @remarks
 * A declared JSON `POST` can opt into response receipts. The receipt identity contains the user,
 * caller namespace, public API version, and caller-selected key. Session and OAuth callers cannot
 * replay each other's results, and two OAuth clients owned by one user remain isolated.
 *
 * The request fingerprint length-delimits the method, canonical path, normalized query, normalized
 * content type, and exact body bytes before hashing. Reusing a key for a different fingerprint
 * returns `422 idempotency_key_reuse`. An unfinished claim has a five-minute lease. A completed
 * current receipt remains authoritative for 48 hours. Legacy session receipts retain their stored
 * deadline and fingerprint only during the bounded `0.1.0` dual-read window.
 *
 * `atomic-receipt` completion shares the domain mutation transaction. `json-receipt` completion
 * records a validated JSON success after the handler returns, so process death between mutation and
 * recording can permit another execution after the lease expires. Operations that declare no
 * receipt support reject a supplied key before the handler. Binary, SSE, and bodyless operations
 * therefore cannot imply retry safety by silently ignoring the header.
 *
 * The strict operation pipeline installs this middleware after current scope, membership,
 * capability, visibility, and product checks. A stored response is never an authorization grant.
 *
 * @see `docs/engineering/specs/rest-conventions.md` §"Retry safety".
 */
import { createHash, randomUUID } from 'node:crypto';

import {
  apiIdempotencyReceipt,
  db,
  idempotencyKey,
  type ApiIdempotencyReceiptFormat,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { API_VERSION } from '../api-version';
import type { AppEnv } from '../context';
import { ConflictError, IdempotencyConflictError, ValidationError } from '../error';
import { assertCurrentObjectCommandReplayAccess } from './idempotency-replay-access';
import { isReplayOwnerRequest } from '../replay-owner-contract';

/** How long a completed public API receipt remains authoritative. */
const RECEIPT_RETENTION_MS = 48 * 60 * 60 * 1000;

/**
 * How long an atomically completed object command remains authoritative.
 *
 * @remarks
 * The browser refuses replay 24 hours after the live attempt began. A second 24-hour window gives
 * the server room for a delayed or lost response and clock drift without reclaiming the stable key
 * while any supported client can still send it.
 */
const OBJECT_COMMAND_RETENTION_MS = RECEIPT_RETENTION_MS;

/**
 * Maximum time a process may own an unfinished idempotency claim.
 *
 * @remarks
 * Every API request should finish within minutes. A five-minute lease leaves room for a slow
 * transaction without making a crashed process block the browser's 24-hour replay window.
 */
const IN_PROGRESS_LEASE_MS = 5 * 60 * 1000;

/** Marks a response that was replayed from an earlier attempt rather than freshly computed. */
const REPLAY_HEADER = 'Idempotency-Replayed';

/** Delay before a client checks whether an in-progress request has produced a replayable result. */
const IN_PROGRESS_RETRY_AFTER_SECONDS = 1;

/** The key ownership established before an idempotent route begins its write. */
export interface IdempotencyClaim {
  /** The authenticated account that owns the retry key. */
  readonly userId: string;
  /** The session or OAuth-client namespace that owns the retry key. */
  readonly callerNamespace: string;
  /** The public compatibility contract under which the request was interpreted. */
  readonly apiVersion: string;
  /** The exact caller-provided retry key. */
  readonly key: string;
  /** Unique lease generation that prevents an expired owner from completing its replacement. */
  readonly claimId: string;
  /** Whether completion must share the domain transaction or may follow the response. */
  readonly receiptFormat: Exclude<ApiIdempotencyReceiptFormat, 'legacy-json'>;
  /** Deadline retained after the domain mutation and receipt commit together. */
  readonly completedExpiresAt: Date;
}

/** The successful response a route can commit beside its domain mutation. */
export interface AtomicIdempotencyResult {
  /** The workspace the mutation belongs to, when the route is workspace-scoped. */
  readonly organizationId: string | null;
  /** The HTTP success status replayed to later attempts. */
  readonly responseStatus: number;
  /** The validated JSON body replayed to later attempts. */
  readonly responseBody: unknown;
  /** Safe response metadata that a retry must receive with the stored body. */
  readonly responseHeaders?: Readonly<Record<string, string>>;
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
    .update(apiIdempotencyReceipt)
    .set({
      organizationId: result.organizationId,
      status: 'completed',
      responseStatus: result.responseStatus,
      responseBody: result.responseBody,
      responseHeaders: sanitizeReplayHeaders(result.responseHeaders),
      expiresAt: claim.completedExpiresAt,
    })
    .where(
      and(
        eq(apiIdempotencyReceipt.userId, claim.userId),
        eq(apiIdempotencyReceipt.callerNamespace, claim.callerNamespace),
        eq(apiIdempotencyReceipt.apiVersion, claim.apiVersion),
        eq(apiIdempotencyReceipt.key, claim.key),
        eq(apiIdempotencyReceipt.claimId, claim.claimId),
        eq(apiIdempotencyReceipt.status, 'in_progress'),
      ),
    )
    .returning({ key: apiIdempotencyReceipt.key });
  if (completed.length !== 1) {
    throw new ConflictError('The idempotent request claim is no longer active');
  }
}

const REPLAYABLE_RESPONSE_HEADERS = ['content-language', 'content-type', 'location'] as const;

/** Keep only response metadata that is safe and necessary to reproduce a JSON success. */
function sanitizeReplayHeaders(
  headers: Headers | Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (headers === undefined) return {};
  const source = headers instanceof Headers ? headers : new Headers(headers);
  return Object.fromEntries(
    REPLAYABLE_RESPONSE_HEADERS.flatMap((name) => {
      const value = source.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
}

/** Normalize an HTTP media type without treating distinct representations as equivalent. */
function normalizedContentType(value: string | undefined): string {
  if (value === undefined) return '';
  const [rawType = '', ...rawParameters] = value.split(';');
  const type = rawType.trim().toLowerCase();
  const parameters = rawParameters
    .map((parameter) => {
      const separator = parameter.indexOf('=');
      if (separator < 0) return [parameter.trim().toLowerCase(), ''] as const;
      const name = parameter.slice(0, separator).trim().toLowerCase();
      const rawValue = parameter.slice(separator + 1).trim();
      const normalizedValue = name === 'charset' ? rawValue.toLowerCase() : rawValue;
      return [name, normalizedValue] as const;
    })
    .filter(([name]) => name.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return [type, ...parameters.map(([name, parameter]) => `${name}=${parameter}`)].join(';');
}

/** Sort query keys while retaining the caller's order among repeated values for one key. */
function normalizedQuery(url: URL): string {
  const entries = [...url.searchParams.entries()].map(([key, value], position) => ({
    key,
    value,
    position,
  }));
  entries.sort(
    (left, right) => left.key.localeCompare(right.key) || left.position - right.position,
  );
  const normalized = new URLSearchParams();
  for (const { key, value } of entries) normalized.append(key, value);
  return normalized.toString();
}

/** Add one byte string with an eight-byte length prefix to an incremental digest. */
function addFingerprintPart(hash: ReturnType<typeof createHash>, bytes: Uint8Array): void {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

/**
 * Compute the versioned receipt fingerprint over the exact observable request identity.
 *
 * @param request - The incoming request whose body has not been consumed.
 * @returns A SHA-256 digest of method, canonical path, normalized query and content type, and bytes.
 */
export async function idempotencyFingerprint(request: Request): Promise<string> {
  return fingerprintRequestBytes(request, new Uint8Array(await request.clone().arrayBuffer()));
}

/** Compute a receipt fingerprint from the one bounded body read owned by the middleware. */
function fingerprintRequestBytes(request: Request, body: Uint8Array): string {
  const url = new URL(request.url);
  const encoder = new TextEncoder();
  const hash = createHash('sha256');
  for (const value of [
    request.method.toUpperCase(),
    url.pathname,
    normalizedQuery(url),
    normalizedContentType(request.headers.get('Content-Type') ?? undefined),
  ]) {
    addFingerprintPart(hash, encoder.encode(value));
  }
  addFingerprintPart(hash, body);
  return hash.digest('base64url');
}

/** The legacy text fingerprint retained only while old session receipts can still replay. */
function legacyFingerprint(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method}\n${path}\n${body}`).digest('base64url');
}

/** Select the retention contract published by one request line. */
function retentionMs(method: string, path: string): number {
  return isReplayOwnerRequest(method, path) ? OBJECT_COMMAND_RETENTION_MS : RECEIPT_RETENTION_MS;
}

/**
 * Apply the current lease and completed-retention policy to rows created before it shipped.
 *
 * @remarks
 * Old unfinished object-command claims can carry a 48-hour `expiresAt`, so cap them at the current
 * five-minute lease. A completed legacy row keeps its stored deadline. The migration must not grant
 * a receipt more authority than the old application wrote.
 */
function effectiveExpiry(record: {
  readonly method: string;
  readonly path: string;
  readonly status: 'in_progress' | 'completed';
  readonly expiresAt: Date;
  readonly createdAt: Date;
}): Date {
  if (record.status === 'in_progress') {
    return new Date(
      Math.min(record.expiresAt.getTime(), record.createdAt.getTime() + IN_PROGRESS_LEASE_MS),
    );
  }
  return record.expiresAt;
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
 * sees an `in_progress` record and gets `409` with `Retry-After: 1` rather than executing the
 * same create twice. That header distinguishes this temporary refusal from a domain `409`.
 * A process death can leave a row `in_progress` until the first request after its five-minute lease
 * conditionally removes and reclaims it.
 */
/** The retry behavior one operation declares in its public contract. */
export type IdempotencyReceiptMode = false | 'json-receipt' | 'atomic-receipt';

interface ReceiptOwner {
  readonly userId: string;
  readonly callerNamespace: string;
}

/** Resolve the authenticated caller identity that scopes a public retry key. */
function receiptOwner(c: Parameters<MiddlewareHandler<AppEnv>>[0]): ReceiptOwner | null {
  const principal = c.get('principal');
  if (principal?.kind === 'oauth') {
    return { userId: principal.userId, callerNamespace: `oauth:${principal.clientId}` };
  }
  if (principal?.kind === 'session') {
    return { userId: principal.userId, callerNamespace: 'session' };
  }
  const session = c.get('session');
  return session?.user ? { userId: session.user.id, callerNamespace: 'session' } : null;
}

/** Return a completed response without copying any historical request identity or credentials. */
function replayResponse(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>>,
): Response {
  const response = c.json(body, status as ContentfulStatusCode);
  for (const [name, value] of Object.entries(sanitizeReplayHeaders(headers))) {
    response.headers.set(name, value);
  }
  response.headers.set(REPLAY_HEADER, 'true');
  // The transitional app adapter invokes this middleware directly and awaits it instead of
  // returning its Response. Finalizing the shared Context keeps that wrapper from discarding a
  // replay before Task 4 removes the legacy composition.
  c.res = response;
  return c.res;
}

/** Compare and replay one still-live legacy session receipt created by an older application. */
async function replayLegacyReceipt(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  owner: ReceiptOwner,
  key: string,
  path: string,
  requestBody: string,
): Promise<Response | null> {
  if (owner.callerNamespace !== 'session' || API_VERSION !== '0.1.0') return null;
  const [prior] = await db
    .select()
    .from(idempotencyKey)
    .where(and(eq(idempotencyKey.userId, owner.userId), eq(idempotencyKey.key, key)))
    .limit(1);
  if (!prior) return null;
  const now = new Date();
  if (effectiveExpiry(prior) <= now) {
    await db
      .delete(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.userId, owner.userId),
          eq(idempotencyKey.key, key),
          eq(idempotencyKey.status, prior.status),
          eq(idempotencyKey.expiresAt, prior.expiresAt),
          eq(idempotencyKey.createdAt, prior.createdAt),
        ),
      );
    return null;
  }
  const hash = legacyFingerprint(c.req.method, path, requestBody);
  if (prior.requestHash !== hash) throw new IdempotencyConflictError();
  if (prior.status === 'in_progress' || prior.responseStatus === null) {
    c.header('Retry-After', String(IN_PROGRESS_RETRY_AFTER_SECONDS));
    throw new ConflictError('An earlier request with this key is still in flight');
  }
  if (isReplayOwnerRequest(c.req.method, path)) {
    await assertCurrentObjectCommandReplayAccess(
      owner.userId,
      path,
      prior.organizationId,
      requestBody,
      prior.responseBody,
    );
  }
  return replayResponse(c, prior.responseStatus, prior.responseBody, {});
}

function unsupportedIdempotencyKey(): ValidationError {
  return new ValidationError([
    {
      path: ['headers', 'Idempotency-Key'],
      message: 'This operation does not support Idempotency-Key.',
    },
  ]);
}

/** Build an idempotency middleware for one declared response persistence guarantee. */
export function idempotencyFor(receiptMode: IdempotencyReceiptMode): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header('Idempotency-Key');
    if (key === undefined) return next();
    if (receiptMode === false || key === '') throw unsupportedIdempotencyKey();
    const isUnsafe = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(c.req.method.toUpperCase());
    if (!isUnsafe) return next();
    if (c.req.method !== 'POST') throw unsupportedIdempotencyKey();
    const owner = receiptOwner(c);
    if (owner === null) return next();

    const url = new URL(c.req.url);
    const path = url.pathname;
    const requestBytes = new Uint8Array(await c.req.raw.clone().arrayBuffer());
    const requestBody = new TextDecoder().decode(requestBytes);
    const hash = fingerprintRequestBytes(c.req.raw, requestBytes);
    const completedExpiresAt = new Date(Date.now() + retentionMs(c.req.method, path));
    const legacyReplay = await replayLegacyReceipt(c, owner, key, path, requestBody);
    if (legacyReplay) return legacyReplay;
    let claimId: string;

    for (;;) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + IN_PROGRESS_LEASE_MS);
      const proposedClaimId = randomUUID();
      const claimed = await db
        .insert(apiIdempotencyReceipt)
        .values({
          ...owner,
          apiVersion: API_VERSION,
          key,
          claimId: proposedClaimId,
          method: c.req.method,
          path,
          requestHash: hash,
          receiptFormat: receiptMode,
          status: 'in_progress',
          expiresAt,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ claimId: apiIdempotencyReceipt.claimId });
      if (claimed.length > 0) {
        claimId = proposedClaimId;
        break;
      }

      const [prior] = await db
        .select()
        .from(apiIdempotencyReceipt)
        .where(
          and(
            eq(apiIdempotencyReceipt.userId, owner.userId),
            eq(apiIdempotencyReceipt.callerNamespace, owner.callerNamespace),
            eq(apiIdempotencyReceipt.apiVersion, API_VERSION),
            eq(apiIdempotencyReceipt.key, key),
          ),
        )
        .limit(1);
      if (!prior) continue;
      if (effectiveExpiry(prior) <= now) {
        await db
          .delete(apiIdempotencyReceipt)
          .where(
            and(
              eq(apiIdempotencyReceipt.userId, owner.userId),
              eq(apiIdempotencyReceipt.callerNamespace, owner.callerNamespace),
              eq(apiIdempotencyReceipt.apiVersion, API_VERSION),
              eq(apiIdempotencyReceipt.key, key),
              eq(apiIdempotencyReceipt.claimId, prior.claimId),
              eq(apiIdempotencyReceipt.status, prior.status),
            ),
          );
        continue;
      }
      const expectedHash =
        prior.receiptFormat === 'legacy-json'
          ? legacyFingerprint(c.req.method, path, requestBody)
          : hash;
      if (prior.requestHash !== expectedHash) throw new IdempotencyConflictError();
      if (prior.status === 'in_progress' || prior.responseStatus === null) {
        c.header('Retry-After', String(IN_PROGRESS_RETRY_AFTER_SECONDS));
        throw new ConflictError('An earlier request with this key is still in flight');
      }
      if (isReplayOwnerRequest(c.req.method, path)) {
        await assertCurrentObjectCommandReplayAccess(
          owner.userId,
          path,
          prior.organizationId,
          requestBody,
          prior.responseBody,
        );
      }
      return replayResponse(c, prior.responseStatus, prior.responseBody, prior.responseHeaders);
    }

    const claim: IdempotencyClaim = {
      ...owner,
      apiVersion: API_VERSION,
      key,
      claimId,
      receiptFormat: receiptMode,
      completedExpiresAt,
    };
    c.set('idempotencyClaim', claim);

    await next();

    if (c.get('idempotencyCompleted') === true) return;
    const identity = and(
      eq(apiIdempotencyReceipt.userId, owner.userId),
      eq(apiIdempotencyReceipt.callerNamespace, owner.callerNamespace),
      eq(apiIdempotencyReceipt.apiVersion, API_VERSION),
      eq(apiIdempotencyReceipt.key, key),
      eq(apiIdempotencyReceipt.claimId, claimId),
    );
    if (receiptMode === 'atomic-receipt') {
      await db.delete(apiIdempotencyReceipt).where(identity);
      throw new Error('An atomic idempotency operation did not complete its receipt transaction.');
    }

    const isJson = /\bapplication\/(?:[^;+]+\+)?json\b/iu.test(
      c.res.headers.get('Content-Type') ?? '',
    );
    if (c.res.status < 400 && isJson) {
      const completed = await db
        .update(apiIdempotencyReceipt)
        .set({
          status: 'completed',
          responseStatus: c.res.status,
          responseBody: await c.res.clone().json(),
          responseHeaders: sanitizeReplayHeaders(c.res.headers),
          expiresAt: completedExpiresAt,
        })
        .where(and(identity, eq(apiIdempotencyReceipt.status, 'in_progress')))
        .returning({ claimId: apiIdempotencyReceipt.claimId });
      if (completed.length !== 1) {
        throw new ConflictError('The idempotent request claim is no longer active');
      }
      return;
    }
    await db.delete(apiIdempotencyReceipt).where(identity);
  };
}

/**
 * Reject retry keys on undeclared operations while object commands enforce them after org access.
 *
 * @remarks
 * The object-command child route installs its atomic adapter after the parent organization guard.
 * Running a receipt adapter here would let a stored response bypass that guard. Every other legacy
 * declaration has no trustworthy response contract, so a supplied key is rejected before its
 * handler instead of guessing that an arbitrary response can be stored and replayed.
 */
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (isReplayOwnerRequest(c.req.method, path)) return next();
  return idempotencyFor(false)(c, next);
};
