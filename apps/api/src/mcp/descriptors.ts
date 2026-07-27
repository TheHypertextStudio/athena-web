/**
 * `@docket/api` — resolve human names to entity ids for the MCP tool surface.
 *
 * @remarks
 * The rule the tool surface is built on is that a call should correspond to something a person
 * would say, and must not require a prior call to construct. "Reassign Sarah's open work to me" is
 * one sentence; it should not need a lookup round trip first. So every id-shaped tool parameter
 * accepts a name, and the server resolves it here.
 *
 * Descriptors are plain strings rather than a `string | {id}` union on purpose: a union widens the
 * JSON Schema a model has to satisfy for no gain, since a ULID is unambiguously distinguishable
 * from a name by shape.
 *
 * Resolution never guesses. An ambiguous or unmatched name raises a {@link ValidationError}
 * carrying the candidates, so the caller's next attempt is informed rather than a re-roll. It
 * builds that through the ordinary `invalid_value` issue path so the failure renders identically
 * to any other field error — one error contract, not two.
 */
import {
  actor,
  cycle,
  db,
  initiative,
  label,
  program,
  project,
  task as taskTable,
  team,
  user,
} from '@docket/db';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';

/** The entity kinds a descriptor can name. */
export type DescriptorKind =
  | 'actor'
  | 'team'
  | 'project'
  | 'program'
  | 'initiative'
  | 'label'
  | 'cycle';

/** How many candidate names an error lists before truncating. */
const MAX_SUGGESTIONS = 12;

/** Every id in Docket is a 26-char Crockford-base32 ULID, so a name can never be mistaken for one. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** The sentence appended to every descriptor parameter's description. */
export const DESCRIPTOR_HINT =
  'Accepts the name or the id — "Platform Migration" works as well as the raw id.';

/** One thing a descriptor could be referring to. */
interface Candidate {
  readonly id: string;
  readonly label: string;
  /** A second exact-matchable handle, e.g. a team key or a member's email. */
  readonly alt?: string;
}

/**
 * Raise a field error naming what the caller could have meant.
 *
 * @remarks
 * Routed through a zod `invalid_value` issue rather than a bespoke shape so `toFieldIssue` turns
 * it into the same `{code:'invalid_option', options}` any enum mismatch produces, and the MCP
 * renderer prints it with the same "allowed values" line.
 *
 * @param field - The parameter that failed, so the caller knows which argument to change.
 * @param value - What they supplied.
 * @param message - What went wrong.
 * @param candidates - The options to offer back.
 */
function unresolved(
  field: string,
  value: string,
  message: string,
  candidates: readonly Candidate[],
): never {
  throw new ValidationError(
    new z.ZodError([
      {
        code: 'invalid_value',
        path: [field],
        message,
        values: candidates.slice(0, MAX_SUGGESTIONS).map((candidate) => candidate.label),
        input: value,
      },
    ]),
  );
}

/**
 * Choose the single candidate a name refers to.
 *
 * @remarks
 * Ordered most-precise first so an exact match is never beaten by a longer name it happens to
 * prefix — "Core" must resolve to the team called Core even when "Core Platform" also exists. Each
 * tier is accepted only when unambiguous; two equally good matches is a question for the caller,
 * not a coin flip.
 *
 * @param field - The parameter being resolved, for the error.
 * @param value - The name the caller supplied.
 * @param candidates - Everything in scope it could refer to.
 * @returns the resolved id.
 */
function pick(field: string, value: string, candidates: readonly Candidate[]): string {
  const needle = value.trim().toLowerCase();
  const tiers: readonly ((candidate: Candidate) => boolean)[] = [
    (candidate) =>
      candidate.label.toLowerCase() === needle || candidate.alt?.toLowerCase() === needle,
    (candidate) => candidate.label.toLowerCase().startsWith(needle),
    (candidate) => candidate.label.toLowerCase().includes(needle),
  ];

  for (const matches of tiers) {
    const hits = candidates.filter(matches);
    const only = hits.length === 1 ? hits[0] : undefined;
    if (only) return only.id;
    if (hits.length > 1) {
      unresolved(
        field,
        value,
        `"${value}" matches more than one ${field}. Name one exactly.`,
        hits,
      );
    }
  }
  unresolved(field, value, `Nothing named "${value}" was found.`, candidates);
}

/**
 * Load what a descriptor could name within an org.
 *
 * @remarks
 * `onlyId` narrows the same queries to a single primary key. That is what keeps the id path — the
 * overwhelmingly common one, since an agent passes back ids earlier tools returned — from loading
 * every actor or project in the org just to confirm one row exists.
 *
 * @param orgId - The organization to search.
 * @param kind - The entity kind.
 * @param onlyId - Restrict to this id instead of listing every candidate.
 * @returns the candidates, each with the handles a caller might use.
 */
async function candidatesFor(
  orgId: string,
  kind: DescriptorKind,
  onlyId?: string,
): Promise<Candidate[]> {
  const only = (column: AnyPgColumn): SQL | undefined =>
    onlyId === undefined ? undefined : eq(column, onlyId);
  switch (kind) {
    case 'actor': {
      // Left-joined so an agent Actor, which has no user row, is still resolvable by display name.
      const rows = await db
        .select({ id: actor.id, label: actor.displayName, alt: user.email })
        .from(actor)
        .leftJoin(user, eq(actor.userId, user.id))
        .where(
          and(
            eq(actor.organizationId, orgId),
            eq(actor.status, 'active'),
            isNull(actor.archivedAt),
            only(actor.id),
          ),
        );
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        ...(row.alt ? { alt: row.alt } : {}),
      }));
    }
    case 'team':
      return db
        .select({ id: team.id, label: team.name, alt: team.key })
        .from(team)
        .where(and(eq(team.organizationId, orgId), isNull(team.archivedAt), only(team.id)));
    case 'project':
      return db
        .select({ id: project.id, label: project.name })
        .from(project)
        .where(
          and(eq(project.organizationId, orgId), isNull(project.archivedAt), only(project.id)),
        );
    case 'program':
      return db
        .select({ id: program.id, label: program.name })
        .from(program)
        .where(
          and(eq(program.organizationId, orgId), isNull(program.archivedAt), only(program.id)),
        );
    case 'initiative':
      return db
        .select({ id: initiative.id, label: initiative.name })
        .from(initiative)
        .where(
          and(
            eq(initiative.organizationId, orgId),
            isNull(initiative.archivedAt),
            only(initiative.id),
          ),
        );
    case 'label':
      return db
        .select({ id: label.id, label: label.name })
        .from(label)
        .where(and(eq(label.organizationId, orgId), only(label.id)));
    case 'cycle': {
      // A cycle's name is nullable and its number is the stable handle, so both are offered.
      const rows = await db
        .select({ id: cycle.id, name: cycle.name, number: cycle.number })
        .from(cycle)
        .where(and(eq(cycle.organizationId, orgId), isNull(cycle.archivedAt), only(cycle.id)));
      return rows.map((row) => ({
        id: row.id,
        label: row.name ?? `Cycle ${row.number}`,
        alt: String(row.number),
      }));
    }
  }
}

/**
 * Resolve a descriptor to an entity id within an organization.
 *
 * @remarks
 * Names fall through to {@link pick}, which pays a candidate scan — acceptable because every kind
 * here is a small set (actors, teams, projects, labels, cycles), never the task table.
 *
 * @param orgId - The organization to resolve within.
 * @param kind - What the descriptor names.
 * @param value - The id or name supplied by the caller.
 * @param field - The tool parameter it came from, used in the error.
 * @returns the resolved entity id.
 * @throws {ValidationError} When the name is ambiguous or matches nothing.
 * @throws {NotFoundError} When a well-formed id is not in this org.
 */
export async function resolveDescriptor(
  orgId: string,
  kind: DescriptorKind,
  value: string,
  field: string = kind,
): Promise<string> {
  if (ULID.test(value)) {
    const [match] = await candidatesFor(orgId, kind, value);
    // A well-formed id that is absent is a miss, not a naming problem — say so plainly rather
    // than offering every name in the org as an alternative.
    if (!match) throw new NotFoundError(`No ${kind} with that id in this organization`);
    return match.id;
  }
  return pick(field, value, await candidatesFor(orgId, kind));
}

/**
 * Resolve a descriptor that could name any of several kinds, saying which it turned out to be.
 *
 * @remarks
 * Some relations accept more than one kind on one side — "the migration project contributes to Q3"
 * and "the Platform program contributes to Q3" are the same sentence, and the speaker never says
 * which table it lives in. Resolving kind-by-kind and taking the first that succeeds would report
 * an ambiguity within one kind as "nothing by that name", because the second attempt overwrites the
 * first's answer. Pooling the candidates first means {@link pick} sees the whole field, so a name
 * matching a project AND a program is reported as the ambiguity it is.
 *
 * @param orgId - The organization to resolve within.
 * @param kinds - The kinds the descriptor may name, most likely first.
 * @param value - The id or name supplied by the caller.
 * @param field - The tool parameter it came from, used in the error.
 * @returns the resolved id and the kind it belongs to.
 * @throws {ValidationError} When the name is ambiguous or matches nothing across all `kinds`.
 * @throws {NotFoundError} When a well-formed id is in none of them.
 */
export async function resolveAcross<K extends DescriptorKind>(
  orgId: string,
  kinds: readonly K[],
  value: string,
  field: string,
): Promise<{ id: string; kind: K }> {
  const byId = ULID.test(value);
  const pools = await Promise.all(
    kinds.map(async (kind) => ({
      kind,
      candidates: await candidatesFor(orgId, kind, byId ? value : undefined),
    })),
  );
  const owner = new Map<string, K>();
  const all: Candidate[] = [];
  for (const pool of pools) {
    for (const candidate of pool.candidates) {
      owner.set(candidate.id, pool.kind);
      all.push(candidate);
    }
  }

  const id = byId ? all[0]?.id : pick(field, value, all);
  if (id === undefined) {
    throw new NotFoundError(`No ${kinds.join(' or ')} with that id in this organization`);
  }
  const kind = owner.get(id);
  /* v8 ignore next -- @preserve defensive: every candidate was recorded with its kind above */
  if (kind === undefined) throw new NotFoundError();
  return { id, kind };
}

/**
 * The kinds a comment or status update can be about.
 *
 * @remarks
 * A superset of {@link DescriptorKind} on one side and a subset on the other: `task` belongs here
 * because you comment on tasks, and is absent from descriptors because task titles are not unique
 * enough to name one by.
 */
export type SubjectKind = 'task' | 'project' | 'program' | 'initiative';

/**
 * Resolve the subject of a comment or update, accepting a name for anything but a task.
 *
 * @remarks
 * Tasks are id-only on purpose. Every other kind here is a small, deliberately-named set where two
 * things sharing a name is a mistake someone will fix; task titles repeat constantly ("Follow up",
 * "Write the migration"), so resolving one by name would silently comment on the wrong item.
 *
 * @param orgId - The organization the subject belongs to.
 * @param kind - What kind of thing it is.
 * @param value - The id, or the name for a container.
 * @param field - The tool parameter it came from, used in the error.
 * @returns the resolved id.
 * @throws {NotFoundError} When a task id is not in this org.
 */
export async function resolveSubject(
  orgId: string,
  kind: SubjectKind,
  value: string,
  field: string,
): Promise<string> {
  if (kind !== 'task') return resolveDescriptor(orgId, kind, value, field);
  const rows = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(and(eq(taskTable.id, value), eq(taskTable.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('No task with that id in this organization');
  return row.id;
}

/**
 * Resolve an optional descriptor, passing `undefined` and `null` through untouched.
 *
 * @remarks
 * Overloaded rather than split in two so a caller writing to a NOT NULL column does not receive a
 * nullable id it then has to narrow, while a caller clearing a nullable reference keeps its null.
 */
export async function resolveOptional(
  orgId: string,
  kind: DescriptorKind,
  value: string | undefined,
  field?: string,
): Promise<string | undefined>;
export async function resolveOptional(
  orgId: string,
  kind: DescriptorKind,
  value: string | null | undefined,
  field?: string,
): Promise<string | null | undefined>;
export async function resolveOptional(
  orgId: string,
  kind: DescriptorKind,
  value: string | null | undefined,
  field?: string,
): Promise<string | null | undefined> {
  if (value === undefined || value === null) return value;
  return resolveDescriptor(orgId, kind, value, field);
}
