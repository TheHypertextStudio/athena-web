/**
 * `@docket/api` — the vocabulary every `link` relation shares.
 *
 * @remarks
 * Each relation lives in its own module (`link-blocks.ts`, `link-task-relations.ts`,
 * `link-containers.ts`) and answers in the one {@link RelationResult} shape, so the tool can record
 * a change set and report back without knowing which table the relation was stored in.
 */
import { z } from 'zod';

import { ValidationError } from '../error';
import type { InitiativeAccess } from '../routes/initiative-hierarchy';
import type { RecordedChange } from './change-set';

/** The relations `link` understands. */
export const RELATIONS = [
  'blocks',
  'relates_to',
  'subtask_of',
  'contributes_to',
  'nested_under',
] as const;

/** One relation. */
export type Relation = (typeof RELATIONS)[number];

/** The kinds of work a relation can join. */
export const ENDPOINT_KINDS = ['task', 'project', 'program', 'initiative'] as const;

/** One kind of work at either end of a relation. */
export type EndpointKind = (typeof ENDPOINT_KINDS)[number];

/** Authorize the caller on one endpoint before it is touched. */
export type Guard = (kind: EndpointKind, id: string) => Promise<void>;

/** One `link` call, as each relation module receives it. */
export interface RelationRequest {
  /** The organization both endpoints must belong to. */
  readonly orgId: string;
  /** The member the change runs as. */
  readonly actorId: string;
  /** The subject descriptor or id. */
  readonly from: string;
  /** The object descriptor or id. */
  readonly to: string;
  /** Whether to take the relation back rather than assert it. */
  readonly remove: boolean;
  /** Runs before each endpoint is written. */
  readonly guard: Guard;
  /** Which Initiatives the caller may see, for hierarchy validation. */
  readonly access: InitiativeAccess;
}

/** What applying one relation did. */
export interface RelationResult {
  readonly from: string;
  readonly to: string;
  readonly fromKind: EndpointKind;
  readonly toKind: EndpointKind;
  readonly changed: boolean;
  readonly changes: RecordedChange[];
  /** Task ids whose search document moved as a result. */
  readonly reindex: readonly string[];
}

/** The two resolved ends of a relation. */
export interface ResolvedEnds {
  readonly from: string;
  readonly to: string;
  readonly fromKind: EndpointKind;
  readonly toKind: EndpointKind;
}

/** A result for a relation that already stood the way the caller asked. */
export function unchanged(ends: ResolvedEnds): RelationResult {
  return { ...ends, changed: false, changes: [], reindex: [] };
}

/**
 * Refuse an endpoint that names the wrong kind of work, listing the kinds that would fit.
 *
 * @remarks
 * The MCP error contract carries a field's issue code and its allowed values, never prose, so the
 * kinds are the actionable part: `to: invalid_option (allowed values: project)` tells the caller
 * the other end must be a project too.
 */
export function rejectKind(field: string, value: string, allowed: readonly string[]): never {
  throw new ValidationError(
    new z.ZodError([
      {
        code: 'invalid_value',
        path: [field],
        values: [...allowed],
        message: `Expected ${allowed.join(' or ')}.`,
        input: value,
      },
    ]),
  );
}

/** Refuse a relation from an item to itself. */
export function rejectSelf(field: string, value: string): never {
  throw new ValidationError(
    new z.ZodError([
      {
        code: 'custom',
        path: [field],
        message: 'An item cannot stand in a relation to itself.',
        input: value,
      },
    ]),
  );
}

/** Refuse a task named by anything but its id; titles repeat too often to resolve. */
export function rejectTaskName(field: string, value: string): never {
  throw new ValidationError(
    new z.ZodError([
      {
        code: 'invalid_format',
        format: 'ulid',
        path: [field],
        message: 'Tasks are named by id.',
        input: value,
      },
    ]),
  );
}
