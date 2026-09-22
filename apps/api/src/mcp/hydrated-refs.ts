/**
 * `@docket/api` — the references a hydrated read carries to the things it points at.
 *
 * @remarks
 * A read that names related work — a project's active tasks, the project an update reports on —
 * has to say enough about each for a card to draw it as a row: what state it is in, in the owning
 * team's own words, and where it opens. The card cannot look any of that up, so the server sends
 * it with the reference.
 */
import { cycle, db, initiative, program, project, task } from '@docket/db';
import { defaultCycleName } from '@docket/work/cycle-contract';
import { and, eq } from 'drizzle-orm';

import type { WorkflowStateType } from '../contracts/team';
import { entityHref, type ReadableType } from './entity-href';
import { stateNameOf, stateTypeOf, teamWorkflows, type TeamWorkflows } from './workflow-states';

/** The task columns a stateful reference is built from. */
export interface TaskRefSource {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly teamId: string | null;
  readonly projectId: string | null;
}

/** A related task, with its state as the owning team names it and the route it opens at. */
export interface StatefulTaskRef {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly stateType: WorkflowStateType | null;
  readonly stateName: string | null;
  readonly projectId: string | null;
  readonly href: string;
}

/** Build one reference against workflows already loaded. */
export function statefulRef(
  orgId: string,
  row: TaskRefSource,
  workflows: TeamWorkflows,
): StatefulTaskRef {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    stateType: stateTypeOf(workflows, row.teamId, row.state) ?? null,
    stateName: stateNameOf(workflows, row.teamId, row.state) ?? null,
    projectId: row.projectId,
    href: entityHref(orgId, 'task', row.id),
  };
}

/**
 * Build stateful references for several groups of tasks with one workflow lookup.
 *
 * @param orgId - The organization the tasks belong to.
 * @param groups - Task rows by group name, already filtered to what the caller may see.
 * @param loaded - Workflows the caller already loaded for every row's team; looked up when absent.
 * @returns The same groups, each row a {@link StatefulTaskRef}.
 */
export async function taskRefGroups<K extends string>(
  orgId: string,
  groups: Readonly<Record<K, readonly TaskRefSource[]>>,
  loaded?: TeamWorkflows,
): Promise<Record<K, StatefulTaskRef[]>> {
  const rows = Object.values<readonly TaskRefSource[]>(groups).flat();
  const workflows =
    loaded ??
    (await teamWorkflows(
      orgId,
      rows.map((row) => row.teamId).filter((teamId): teamId is string => teamId !== null),
    ));
  const out = {} as Record<K, StatefulTaskRef[]>;
  for (const key of Object.keys(groups) as K[]) {
    out[key] = groups[key].map((row) => statefulRef(orgId, row, workflows));
  }
  return out;
}

/**
 * Build stateful references for one list of tasks.
 *
 * @param orgId - The organization the tasks belong to.
 * @param rows - Task rows, already filtered to what the caller may see.
 * @returns One {@link StatefulTaskRef} per row, in order.
 */
export async function taskRefsWithState(
  orgId: string,
  rows: readonly TaskRefSource[],
): Promise<StatefulTaskRef[]> {
  return (await taskRefGroups(orgId, { rows })).rows;
}

/**
 * Add the product route to each reference in a list.
 *
 * @param orgId - The organization the rows belong to.
 * @param type - What kind of entity every row is.
 * @param rows - References with an `id`.
 * @returns The rows, each with its `href`.
 */
export function withHrefs<T extends { readonly id: string }>(
  orgId: string,
  type: ReadableType,
  rows: readonly T[],
): (T & { readonly href: string })[] {
  return rows.map((row) => ({ ...row, href: entityHref(orgId, type, row.id) }));
}

/** What an update or comment is about, named the way its own page names it. */
export interface SubjectRef {
  readonly type: string;
  readonly id: string;
  readonly name: string | null;
  readonly href: string | null;
}

type NameLookup = (orgId: string, id: string) => Promise<string | null>;

/** The display name of each kind of subject, read from its own table. */
const SUBJECT_NAMES: Readonly<Record<string, NameLookup>> = {
  task: async (orgId, id) =>
    (
      await db
        .select({ name: task.title })
        .from(task)
        .where(and(eq(task.id, id), eq(task.organizationId, orgId)))
        .limit(1)
    )[0]?.name ?? null,
  project: async (orgId, id) =>
    (
      await db
        .select({ name: project.name })
        .from(project)
        .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
        .limit(1)
    )[0]?.name ?? null,
  program: async (orgId, id) =>
    (
      await db
        .select({ name: program.name })
        .from(program)
        .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
        .limit(1)
    )[0]?.name ?? null,
  initiative: async (orgId, id) =>
    (
      await db
        .select({ name: initiative.name })
        .from(initiative)
        .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
        .limit(1)
    )[0]?.name ?? null,
  cycle: async (orgId, id) => {
    const row = (
      await db
        .select({ name: cycle.name, startsAt: cycle.startsAt, endsAt: cycle.endsAt })
        .from(cycle)
        .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
        .limit(1)
    )[0];
    return row ? (row.name ?? defaultCycleName(row.startsAt, row.endsAt)) : null;
  },
};

/** Whether a subject kind has a product route of its own. */
function isReadable(type: string): type is ReadableType {
  return (
    type === 'task' ||
    type === 'project' ||
    type === 'program' ||
    type === 'initiative' ||
    type === 'cycle'
  );
}

/**
 * Name the subject an update or comment is attached to.
 *
 * @param orgId - The organization the subject belongs to.
 * @param type - The subject's kind, as stored on the update or comment.
 * @param id - The subject's id.
 * @returns The subject's name and route; the name is `null` when the subject no longer exists.
 */
export async function subjectRefOf(orgId: string, type: string, id: string): Promise<SubjectRef> {
  const lookup = Object.prototype.hasOwnProperty.call(SUBJECT_NAMES, type)
    ? SUBJECT_NAMES[type]
    : undefined;
  const name = lookup ? await lookup(orgId, id) : null;
  const href = isReadable(type) && name !== null ? entityHref(orgId, type, id) : null;
  return { type, id, name, href };
}
