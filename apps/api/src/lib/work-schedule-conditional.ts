/** Transactional optimistic concurrency for the caller-owned default work schedule. */
import { createHash } from 'node:crypto';

import { workScheduleAggregateRevision, type Database } from '@docket/db';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { PreconditionFailedError, ValidationError } from '../error';
import type { ConditionalResourceKind } from './api-operation-contract';
import { hasSqlState } from './sql-state';

/** The only aggregate whose writer census currently satisfies conditional-write requirements. */
export const WORK_SCHEDULE_CONDITIONAL_RESOURCE = 'work-schedule' satisfies ConditionalResourceKind;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The representation and strong validator read from one repeatable database snapshot. */
export interface WorkScheduleConditionalRead<T> {
  readonly value: T;
  readonly etag: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 22);
}

/** Bind a strong validator to one Hub, aggregate revision, and exact JSON representation. */
export function workScheduleEtag(hubId: string, revision: number, value: unknown): string {
  const resource = digest(`work-schedule\0${hubId}`);
  const representation = digest(JSON.stringify(value));
  return `"ws.${resource}.${String(revision)}.${representation}"`;
}

const STRONG_VALIDATOR = /"(?:[\u0021\u0023-\u007e\u0080-\uffff])*"/uy;

function skipOptionalWhitespace(header: string, start: number): number {
  let position = start;
  while (header[position] === ' ' || header[position] === '\t') position += 1;
  return position;
}

function validatorAt(
  header: string,
  start: number,
): { readonly next: number; readonly value: string } | null {
  STRONG_VALIDATOR.lastIndex = start;
  const match = STRONG_VALIDATOR.exec(header);
  return match ? { next: STRONG_VALIDATOR.lastIndex, value: match[0] } : null;
}

/** Parse the strong entity-tag list accepted by the schedule transaction adapter. */
function strongValidators(header: string): readonly string[] | null {
  const validators: string[] = [];
  let position = skipOptionalWhitespace(header, 0);
  while (position < header.length) {
    const validator = validatorAt(header, position);
    if (!validator) return null;
    validators.push(validator.value);
    position = skipOptionalWhitespace(header, validator.next);
    if (position === header.length) return validators;
    if (header[position] !== ',') return null;
    position = skipOptionalWhitespace(header, position + 1);
  }
  return null;
}

function selectsStrongValidator(header: string, current: string): boolean {
  return strongValidators(header)?.includes(current) ?? false;
}

function unsupportedIfMatch(): ValidationError {
  return new ValidationError([
    {
      path: ['headers', 'If-Match'],
      message: 'This operation does not support If-Match.',
    },
  ]);
}

/**
 * Enforce the declared conditional-write boundary before input validation and handler effects.
 *
 * @remarks
 * The work-schedule branch validates only syntax here. The repository adapter performs the
 * authoritative comparison and mutation while holding the aggregate lock in one serializable
 * transaction.
 *
 * @param resourceKind - The operation's declared transaction adapter, or false when unsupported.
 * @returns Middleware that rejects unsupported or weak conditional writes before the handler.
 */
export function conditionalWriteFor(
  resourceKind: false | ConditionalResourceKind,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ifMatch = c.req.header('If-Match');
    if (ifMatch === undefined) return next();
    const isUnsafe = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(c.req.method.toUpperCase());
    if (!isUnsafe) return next();
    if (resourceKind === false) throw unsupportedIfMatch();
    if (strongValidators(ifMatch) === null) throw new PreconditionFailedError();
    return next();
  };
}

async function currentRevision(database: Database, hubId: string): Promise<number> {
  const [row] = await database
    .select({ revision: workScheduleAggregateRevision.revision })
    .from(workScheduleAggregateRevision)
    .where(eq(workScheduleAggregateRevision.hubId, hubId))
    .limit(1);
  return row?.revision ?? 0;
}

/** Read one representation and its resource-bound validator from the same repeatable snapshot. */
export async function readConditionalWorkSchedule<T>(
  database: Database,
  hubId: string,
  read: (transaction: Transaction) => Promise<T>,
): Promise<WorkScheduleConditionalRead<T>> {
  return database.transaction(
    async (transaction) => {
      const revision = await currentRevision(transaction, hubId);
      const value = await read(transaction);
      return { value, etag: workScheduleEtag(hubId, revision, value) };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

function retryableTransactionError(error: unknown): boolean {
  return hasSqlState(error, '40001') || hasSqlState(error, '40P01');
}

/**
 * Compare a strong schedule validator and mutate while holding the same aggregate lock.
 *
 * @param database - The database connection that owns the transaction.
 * @param hubId - The caller-owned schedule aggregate.
 * @param ifMatch - The optional strong validator supplied by the client.
 * @param read - Reads the current public representation inside the transaction.
 * @param mutate - Changes only rows covered by the schedule revision triggers.
 * @returns The mutation result after a serializable commit.
 */
export async function writeConditionalWorkSchedule<T, TRepresentation>(
  database: Database,
  hubId: string,
  ifMatch: string | undefined,
  read: (transaction: Transaction) => Promise<TRepresentation>,
  mutate: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.transaction(
        async (transaction) => {
          await transaction
            .insert(workScheduleAggregateRevision)
            .values({ hubId, revision: 0 })
            .onConflictDoNothing();
          const [locked] = await transaction
            .select({ revision: workScheduleAggregateRevision.revision })
            .from(workScheduleAggregateRevision)
            .where(eq(workScheduleAggregateRevision.hubId, hubId))
            .for('update')
            .limit(1);
          if (!locked) throw new Error('The work-schedule revision lock was not created.');
          if (ifMatch !== undefined) {
            const current = workScheduleEtag(hubId, locked.revision, await read(transaction));
            if (!selectsStrongValidator(ifMatch, current)) throw new PreconditionFailedError();
          }
          return mutate(transaction);
        },
        { isolationLevel: 'serializable' },
      );
    } catch (error) {
      if (retryableTransactionError(error) && attempt < 3) continue;
      if (retryableTransactionError(error)) {
        throw new PreconditionFailedError('The work schedule changed during this request');
      }
      throw error;
    }
  }
}
