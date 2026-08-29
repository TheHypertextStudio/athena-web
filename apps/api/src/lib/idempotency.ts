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
 * - An unfinished claim has a five-minute lease. Completed ordinary records remain authoritative
 *   for 24 hours. Completed object-command records remain authoritative for 48 hours because the
 *   offline client may replay for 24 hours after the live attempt began. The first caller after the
 *   effective deadline conditionally removes the expired row and competes to claim the key again.
 * - Only JSON responses are recorded. Streaming and binary handlers have no body worth
 *   replaying, so they pass through unprotected rather than being buffered into memory.
 *
 * @see `docs/engineering/specs/rest-conventions.md` §"Retry safety".
 */
import { createHash } from 'node:crypto';

import { CAPABILITY_RANK, satisfies, type Capability } from '@docket/authz';
import {
  ObjectCommandRequest,
  ObjectCommandResult,
  type ObjectCommandRequest as ObjectCommandRequestValue,
} from '@docket/types';
import { actor, db, idempotencyKey, label } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { AppEnv } from '../context';
import { CapabilityError, ConflictError, IdempotencyConflictError, NotFoundError } from '../error';
import {
  resourceAccessKey,
  resolveResourceAccess,
  type ResourceAccessRef,
} from '../permissions/resource-access';
import { isReplayOwnerRequest } from '../replay-owner-contract';

/** How long an ordinary keyed POST remains authoritative. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * How long an atomically completed object command remains authoritative.
 *
 * @remarks
 * The browser refuses replay 24 hours after the live attempt began. A second 24-hour window gives
 * the server room for a delayed or lost response and clock drift without reclaiming the stable key
 * while any supported client can still send it.
 */
const OBJECT_COMMAND_RETENTION_MS = 48 * 60 * 60 * 1000;

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
  /** The exact caller-provided retry key. */
  readonly key: string;
  /** Generation marker that prevents an expired request from completing a replacement claim. */
  readonly expiresAt: Date;
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
      expiresAt: claim.completedExpiresAt,
    })
    .where(
      and(
        eq(idempotencyKey.userId, claim.userId),
        eq(idempotencyKey.key, claim.key),
        eq(idempotencyKey.expiresAt, claim.expiresAt),
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

/** Select the retention contract published by one request line. */
function retentionMs(method: string, path: string): number {
  return isReplayOwnerRequest(method, path) ? OBJECT_COMMAND_RETENTION_MS : RETENTION_MS;
}

/**
 * Apply the current lease and completed-retention policy to rows created before it shipped.
 *
 * @remarks
 * Old unfinished object-command claims can carry a 48-hour `expiresAt`, so cap them at the current
 * five-minute lease. Old completed rows can carry the former 24-hour deadline, so extend those from
 * immutable `createdAt` without a migration race or a duplicate-execution window.
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
  if (!isReplayOwnerRequest(record.method, record.path)) return record.expiresAt;
  const policyExpiry = record.createdAt.getTime() + OBJECT_COMMAND_RETENTION_MS;
  return new Date(Math.max(record.expiresAt.getTime(), policyExpiry));
}

/** Resolve receipt properties whose scalar values are ids of access-controlled work. */
function receiptReferenceKind(
  objectKind: 'task' | 'project',
  property: string,
): ResourceAccessRef['kind'] | null {
  if (objectKind === 'task') {
    if (property === 'projectId') return 'project';
    if (property === 'programId') return 'program';
    if (property === 'parentTaskId') return 'task';
    return null;
  }
  if (property === 'teamId') return 'team';
  if (property === 'programId') return 'program';
  return null;
}

interface ReplayResourceRequirement {
  readonly ref: ResourceAccessRef;
  readonly capability: Capability;
}

/** Return the write rank the live object-command route requires for one changed object. */
function receiptObjectCapability(
  objectKind: 'task' | 'project',
  action: string,
  property?: string,
): Capability {
  if (objectKind === 'project' && (action === 'trash' || action === 'restore')) return 'manage';
  if (objectKind === 'project' && property === 'archivedAt') return 'manage';
  if (property === 'assigneeId' || property === 'leadId') return 'assign';
  return 'contribute';
}

/** Return the target-object rank for a validated forward command. */
function forwardObjectCapability(
  request: Extract<ObjectCommandRequestValue, { objectKind: 'task' | 'project' }>,
): Capability {
  const operation = request.operation;
  if (
    request.objectKind === 'project' &&
    (operation.type === 'trash' || operation.type === 'restore')
  ) {
    return 'manage';
  }
  if (
    operation.type === 'replace_property' &&
    (operation.property === 'assigneeId' || operation.property === 'leadId')
  ) {
    return 'assign';
  }
  return 'contribute';
}

/** Parse a request body only when it is a complete object-command payload. */
function parseObjectCommandRequest(body: string): ObjectCommandRequestValue | null {
  try {
    const parsed = ObjectCommandRequest.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function assertCurrentObjectCommandReplayAccess(
  userId: string,
  path: string,
  organizationId: string | null,
  requestBody: string,
  responseBody: unknown,
): Promise<void> {
  const parsed = ObjectCommandResult.safeParse(responseBody);
  const pathOrganizationId = /^\/v1\/orgs\/([^/]+)\/object-commands$/u.exec(path)?.[1] ?? null;
  if (!parsed.success || organizationId === null || pathOrganizationId !== organizationId) {
    throw new NotFoundError('Object command result not found');
  }
  const memberships = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, organizationId),
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!memberships[0]) throw new NotFoundError('Object command result not found');

  const receipt = parsed.data.receipt;
  const requirements = new Map<string, ReplayResourceRequirement>();
  const addRequirement = (ref: ResourceAccessRef, capability: Capability): void => {
    const key = resourceAccessKey(ref);
    const current = requirements.get(key);
    if (
      current === undefined ||
      CAPABILITY_RANK[capability] > CAPABILITY_RANK[current.capability]
    ) {
      requirements.set(key, { ref, capability });
    }
  };
  const objectCapabilityById = new Map<string, Capability>();
  for (const entry of receipt.entries) {
    const required = receiptObjectCapability(
      receipt.objectKind,
      receipt.action,
      entry.kind === 'object' ? entry.property : undefined,
    );
    const current = objectCapabilityById.get(entry.objectId);
    if (current === undefined || CAPABILITY_RANK[required] > CAPABILITY_RANK[current]) {
      objectCapabilityById.set(entry.objectId, required);
    }
  }
  for (const id of [
    ...parsed.data.appliedIds,
    ...parsed.data.conflictingIds,
    ...parsed.data.deniedIds,
  ]) {
    addRequirement(
      { organizationId, kind: receipt.objectKind, id },
      objectCapabilityById.get(id) ?? receiptObjectCapability(receipt.objectKind, receipt.action),
    );
  }
  const labelIds: string[] = [];
  for (const entry of receipt.entries) {
    const objectRef: ResourceAccessRef = {
      organizationId,
      kind: receipt.objectKind,
      id: entry.objectId,
    };
    addRequirement(
      objectRef,
      receiptObjectCapability(
        receipt.objectKind,
        receipt.action,
        entry.kind === 'object' ? entry.property : undefined,
      ),
    );
    if (entry.kind === 'object') {
      const referenceKind = receiptReferenceKind(receipt.objectKind, entry.property);
      if (referenceKind !== null) {
        for (const value of [entry.before, entry.after]) {
          if (typeof value === 'string') {
            addRequirement({ organizationId, kind: referenceKind, id: value }, 'view');
          }
        }
      }
      continue;
    }
    if (entry.relation === 'dependency') {
      addRequirement(
        { organizationId, kind: receipt.objectKind, id: entry.relatedId },
        'contribute',
      );
      continue;
    }
    if (entry.relation === 'initiative') {
      addRequirement({ organizationId, kind: 'initiative', id: entry.relatedId }, 'view');
      continue;
    }
    labelIds.push(entry.relatedId);
  }

  const request = parseObjectCommandRequest(requestBody);
  if (request && 'direction' in request) {
    for (const entry of request.receipt.entries) {
      addRequirement(
        { organizationId, kind: request.receipt.objectKind, id: entry.objectId },
        receiptObjectCapability(
          request.receipt.objectKind,
          request.receipt.action,
          entry.kind === 'object' ? entry.property : undefined,
        ),
      );
      if (entry.kind === 'relation' && entry.relation === 'dependency') {
        addRequirement(
          { organizationId, kind: request.receipt.objectKind, id: entry.relatedId },
          'contribute',
        );
      }
      if (entry.kind === 'object') {
        const referenceKind = receiptReferenceKind(request.receipt.objectKind, entry.property);
        const target = request.direction === 'undo' ? entry.before : entry.after;
        if (referenceKind !== null && typeof target === 'string') {
          addRequirement({ organizationId, kind: referenceKind, id: target }, 'contribute');
        }
      }
    }
  } else if (request) {
    const required = forwardObjectCapability(request);
    for (const id of request.objectIds) {
      addRequirement({ organizationId, kind: request.objectKind, id }, required);
    }
    const operation = request.operation;
    if (operation.type === 'add_dependency' || operation.type === 'remove_dependency') {
      for (const id of [operation.blockingId, operation.blockedId]) {
        addRequirement({ organizationId, kind: request.objectKind, id }, 'contribute');
      }
    }
    if (operation.type === 'change_parent' && operation.parentId !== null) {
      addRequirement({ organizationId, kind: 'task', id: operation.parentId }, 'contribute');
    }
    if (operation.type === 'replace_property' && typeof operation.value === 'string') {
      const referenceKind = receiptReferenceKind(request.objectKind, operation.property);
      if (referenceKind !== null) {
        addRequirement({ organizationId, kind: referenceKind, id: operation.value }, 'contribute');
      }
    }
  }

  const uniqueRequirements = [...requirements.values()];
  const accessByResource = await resolveResourceAccess(
    userId,
    uniqueRequirements.map(({ ref }) => ref),
  );
  for (const requirement of uniqueRequirements) {
    const access = accessByResource.get(resourceAccessKey(requirement.ref));
    if (!access?.canView || access.effectiveCapability === null) {
      throw new NotFoundError('Object command result not found');
    }
    if (!satisfies(access.effectiveCapability, requirement.capability)) {
      throw new CapabilityError();
    }
  }
  const uniqueLabelIds = [...new Set(labelIds)];
  if (uniqueLabelIds.length === 0) return;
  const currentLabels = await db
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.organizationId, organizationId), inArray(label.id, uniqueLabelIds)));
  if (currentLabels.length !== uniqueLabelIds.length) {
    throw new NotFoundError('Object command result not found');
  }
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
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('Idempotency-Key');
  const userId = c.get('session')?.user.id;
  if (c.req.method !== 'POST' || key === undefined || key === '' || userId === undefined) {
    return next();
  }

  const path = new URL(c.req.url).pathname;
  const requestBody = await c.req.raw.clone().text();
  const hash = fingerprint(c.req.method, path, requestBody);

  let claimExpiresAt: Date;
  let completedExpiresAt: Date;
  for (;;) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IN_PROGRESS_LEASE_MS);
    const completionDeadline = new Date(now.getTime() + retentionMs(c.req.method, path));
    const claimed = await db
      .insert(idempotencyKey)
      .values({
        userId,
        key,
        method: c.req.method,
        path,
        requestHash: hash,
        status: 'in_progress',
        expiresAt,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKey.key });
    if (claimed.length > 0) {
      claimExpiresAt = expiresAt;
      completedExpiresAt = completionDeadline;
      break;
    }

    const rows = await db
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.userId, userId), eq(idempotencyKey.key, key)))
      .limit(1);
    const prior = rows[0];
    // Another reclaimer can remove the expired row between our failed insert and read. Loop back
    // through the insert so this request never executes without owning a durable claim.
    if (!prior) continue;
    if (effectiveExpiry(prior) <= now) {
      // The expiry predicate is part of the delete. A competing request may already have replaced
      // this row with a fresh claim, and this stale reclaimer must not delete that new owner.
      await db
        .delete(idempotencyKey)
        .where(
          and(
            eq(idempotencyKey.userId, userId),
            eq(idempotencyKey.key, key),
            eq(idempotencyKey.status, prior.status),
            eq(idempotencyKey.expiresAt, prior.expiresAt),
            eq(idempotencyKey.createdAt, prior.createdAt),
          ),
        );
      continue;
    }
    if (prior.requestHash !== hash) throw new IdempotencyConflictError();
    if (prior.status === 'in_progress' || prior.responseStatus === null) {
      c.header('Retry-After', String(IN_PROGRESS_RETRY_AFTER_SECONDS));
      throw new ConflictError('An earlier request with this key is still in flight');
    }
    if (isReplayOwnerRequest(c.req.method, path)) {
      await assertCurrentObjectCommandReplayAccess(
        userId,
        path,
        prior.organizationId,
        requestBody,
        prior.responseBody,
      );
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

  c.set('idempotencyClaim', {
    userId,
    key,
    expiresAt: claimExpiresAt,
    completedExpiresAt,
  });

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
        expiresAt: completedExpiresAt,
      })
      .where(
        and(
          eq(idempotencyKey.userId, userId),
          eq(idempotencyKey.key, key),
          eq(idempotencyKey.expiresAt, claimExpiresAt),
        ),
      );
    return;
  }
  await db
    .delete(idempotencyKey)
    .where(
      and(
        eq(idempotencyKey.userId, userId),
        eq(idempotencyKey.key, key),
        eq(idempotencyKey.expiresAt, claimExpiresAt),
      ),
    );
};
