import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { CanonicalViewQuery, ViewCursor } from '@docket/work/work-view-contract';
import type { ViewTarget } from '@docket/work/view-contract';
import { z } from 'zod';

import { ApiError } from '../../error';

const cursorScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const cursorPayload = z
  .object({
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{16,64}$/),
    groupPath: z.array(z.string()).max(2),
    sortTuple: z.array(cursorScalar),
    entityId: z.string().min(1),
    asOf: z.iso.datetime({ offset: true }),
  })
  .strict();
const cursorEnvelope = z
  .object({ payload: cursorPayload, signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();

/** A scalar value retained from one ordered SQL expression in a keyset cursor. */
export type WorkViewCursorScalar = z.infer<typeof cursorScalar>;

/** The complete continuation position for one executable work-view query. */
export interface WorkViewCursorPayload<E extends ViewTarget> {
  /** Fingerprint of the filter, context, grouping, and ordering that produced this page. */
  readonly fingerprint: CanonicalViewQuery<E>;
  /** Materialized primary and subgroup keys for the last row. */
  readonly groupPath: readonly string[];
  /** Ordered semantic and raw sort values for the last row. */
  readonly sortTuple: readonly WorkViewCursorScalar[];
  /** Stable final tiebreaker for the last row. */
  readonly entityId: string;
  /** Frozen execution time reused by every continuation page. */
  readonly asOf: string;
}

/** Authorization and clock inputs that make one query execution distinct. */
export interface WorkViewExecutionDescriptor {
  /** Workspace boundary requested by the caller. */
  readonly organizationId: string;
  /** Workspace actor that initiated the query. */
  readonly actorId: string;
  /** Cross-workspace user identity, when the actor represents a user. */
  readonly userId: string | null;
  /** IANA timezone used for symbolic temporal operands. */
  readonly timeZone: string;
  /** Frozen ISO timestamp used for all pages. */
  readonly asOf: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function unknownArray(value: unknown): readonly unknown[] | null {
  const parsed = z.array(z.unknown()).safeParse(value);
  return parsed.success ? parsed.data : null;
}

function canonicalFilter(value: unknown): unknown {
  const node = record(value);
  if (!node || typeof node['kind'] !== 'string') return value;
  if (node['kind'] === 'predicate') return node;
  if (node['kind'] === 'not') {
    const child = canonicalFilter(node['child']);
    const childRecord = record(child);
    return childRecord?.['kind'] === 'not'
      ? canonicalFilter(childRecord['child'])
      : { kind: 'not', child };
  }
  const children = unknownArray(node['children']);
  if ((node['kind'] === 'all' || node['kind'] === 'any') && children) {
    const kind = node['kind'];
    const flattened = children.flatMap((child) => {
      const canonical = canonicalFilter(child);
      const childRecord = record(canonical);
      const nestedChildren = unknownArray(childRecord?.['children']);
      return childRecord?.['kind'] === kind && nestedChildren ? nestedChildren : [canonical];
    });
    const unique = new Map(flattened.map((child) => [stableJson(child), child]));
    return {
      kind,
      children: [...unique.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, child]) => child),
    };
  }
  return node;
}

function executableQuery(
  request: object,
  execution?: WorkViewExecutionDescriptor,
): Record<string, unknown> {
  const input = record(request) ?? {};
  const definition = record(input['definition']) ?? {};
  const filters = [definition['filter'], input['temporaryFilter']].filter(
    (filter) => filter !== null && filter !== undefined,
  );
  const filter =
    filters.length === 0
      ? null
      : canonicalFilter(filters.length === 1 ? filters[0] : { kind: 'all', children: filters });
  return {
    target: input['target'],
    context: input['context'],
    filter,
    arrangement: definition['arrangement'],
    execution,
  };
}

/**
 * Fingerprint the executable parts of a work-view request.
 *
 * @param request - A validated target-specific work-view query request.
 * @param execution - Optional authorization, timezone, and frozen-clock execution identity.
 * @returns A target-branded SHA-256 query fingerprint.
 */
export function fingerprintWorkViewQuery<E extends ViewTarget = ViewTarget>(
  request: object,
  execution?: WorkViewExecutionDescriptor,
): CanonicalViewQuery<E> {
  const query = executableQuery(request, execution);
  const digest = createHash('sha256').update(stableJson(query)).digest('hex');
  return `sha256:${digest}` as CanonicalViewQuery<E>;
}

/**
 * Encode a complete keyset position as an opaque work-view cursor.
 *
 * @param payload - Query identity and the last row's full ordering position.
 * @returns A target-branded transport cursor.
 */
export function encodeWorkViewCursor<E extends ViewTarget>(
  payload: WorkViewCursorPayload<E>,
): ViewCursor<E> {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) throw new TypeError('BETTER_AUTH_SECRET is required to sign work-view cursors.');
  const signature = createHmac('sha256', secret).update(stableJson(payload)).digest('base64url');
  const encoded = Buffer.from(stableJson({ payload, signature }), 'utf8').toString('base64url');
  return `wv2:${encoded}` as ViewCursor<E>;
}

/**
 * Decode a cursor and prove that it belongs to the current canonical query.
 *
 * @param cursor - The opaque cursor supplied by the client.
 * @param expectedFingerprint - Fingerprint of the query about to execute.
 * @param expectedGroupPath - Materialized group path whose page is continuing.
 * @returns The validated target-specific continuation payload.
 * @throws {ApiError} When the cursor is malformed or belongs to another query or group path.
 */
export function decodeWorkViewCursor<E extends ViewTarget>(
  cursor: string,
  expectedFingerprint?: CanonicalViewQuery<E>,
  expectedGroupPath?: readonly string[],
): WorkViewCursorPayload<E> {
  let decoded: z.infer<typeof cursorPayload>;
  try {
    if (!cursor.startsWith('wv2:')) throw new TypeError('Wrong cursor version');
    const json = Buffer.from(cursor.slice(4), 'base64url').toString('utf8');
    const envelope = cursorEnvelope.parse(JSON.parse(json));
    const secret = process.env['BETTER_AUTH_SECRET'];
    if (!secret) throw new TypeError('Cursor signing secret is missing');
    const expected = Buffer.from(
      createHmac('sha256', secret).update(stableJson(envelope.payload)).digest('base64url'),
    );
    const actual = Buffer.from(envelope.signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new TypeError('Cursor signature is invalid');
    }
    decoded = envelope.payload;
  } catch {
    throw new ApiError(400, 'validation_error', 'This page cursor is invalid');
  }
  if (expectedFingerprint && decoded.fingerprint !== expectedFingerprint) {
    throw new ApiError(400, 'validation_error', 'This page cursor belongs to another view query');
  }
  if (
    expectedGroupPath &&
    (decoded.groupPath.length !== expectedGroupPath.length ||
      decoded.groupPath.some((key, index) => key !== expectedGroupPath[index]))
  ) {
    throw new ApiError(400, 'validation_error', 'This page cursor belongs to another group');
  }
  return {
    ...decoded,
    fingerprint: decoded.fingerprint as CanonicalViewQuery<E>,
  };
}
