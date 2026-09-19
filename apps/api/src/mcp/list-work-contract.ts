/**
 * `@docket/api` — the filter surface of the `list_work` tool, and what each entity honors.
 *
 * @remarks
 * The four work entities overlap far less than they look: only name/title, status/state, an
 * owner-ish id, and the audit columns are common. Rather than silently ignore a filter that does
 * not apply to the requested entity — the failure mode most likely to make an agent trust a wrong
 * answer — an inapplicable filter is rejected with the list of filters that entity does support.
 *
 * Kept apart from the query bodies so the task and container queries can both read it without
 * importing each other.
 */
import { inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { WorkflowStateType } from '../contracts/team';
import { Priority } from '@docket/work/task-contract';
import { DateResolution } from '@docket/work/planning-timeframe';

import { ValidationError } from '../error';
import { DESCRIPTOR_HINT } from './descriptors';
import type { WorkCursor } from './tools-shared-queries';

/** The entities `list_work` can enumerate. */
export const WORK_ENTITIES = ['task', 'project', 'program', 'initiative'] as const;
/** One listable work entity. */
export type WorkEntity = (typeof WORK_ENTITIES)[number];

/**
 * Which filters each entity actually supports, used to reject the rest with a real explanation.
 *
 * @remarks
 * Keyed by {@link FilterName} rather than `string` so adding a filter to {@link listWorkFilters}
 * without deciding which entities honor it is a compile error, not a silently ignored argument.
 */
export const SUPPORTED: Record<WorkEntity, readonly FilterName[]> = {
  task: [
    'team',
    'project',
    'program',
    'assignee',
    'delegate',
    'state',
    'priority',
    'label',
    'cycle',
    'parent',
    'unfiled',
    'blocked',
    'blocking',
    'dueBefore',
    'dueAfter',
    'updatedAfter',
    'archived',
  ],
  project: ['team', 'program', 'initiative', 'lead', 'status', 'label', 'updatedAfter', 'archived'],
  program: ['owner', 'status', 'initiative', 'updatedAfter', 'archived'],
  initiative: ['owner', 'status', 'label', 'updatedAfter', 'archived'],
};

/**
 * The filter surface, uniform across entities; applicability is checked per call.
 *
 * @remarks
 * Descriptions live here, on the module that implements the filters, so the tool can spread this
 * whole object into its input schema. Restating each field in the tool just to attach a
 * description meant a filter added here but forgotten there silently never reached the query.
 */
export const listWorkFilters = {
  team: z.string().optional().describe(`Only work on this team. ${DESCRIPTOR_HINT}`),
  project: z.string().optional().describe(`Only work in this project. ${DESCRIPTOR_HINT}`),
  program: z.string().optional().describe(`Only work under this program. ${DESCRIPTOR_HINT}`),
  initiative: z
    .string()
    .optional()
    .describe(`Only projects or programs rolling up to this initiative. ${DESCRIPTOR_HINT}`),
  assignee: z
    .string()
    .optional()
    .describe(`Only tasks this person or agent is accountable for. ${DESCRIPTOR_HINT}`),
  delegate: z
    .string()
    .optional()
    .describe(`Only tasks whose doing was handed to this agent. ${DESCRIPTOR_HINT}`),
  lead: z.string().optional().describe(`Only projects led by this person. ${DESCRIPTOR_HINT}`),
  owner: z
    .string()
    .optional()
    .describe(`Only programs or initiatives owned by this person. ${DESCRIPTOR_HINT}`),
  state: z
    .array(z.string())
    .optional()
    .describe(
      'Only tasks in any of these workflow states. Display names resolve when `team` is also set, since states are per-team.',
    ),
  status: z
    .array(z.string())
    .optional()
    .describe('Only projects/programs/initiatives in any of these statuses.'),
  priority: z.array(Priority).optional().describe('Only tasks at any of these priorities.'),
  label: z.string().optional().describe(`Only work carrying this label. ${DESCRIPTOR_HINT}`),
  cycle: z
    .string()
    .optional()
    .describe(`Only tasks committed to this cycle, by name or number. ${DESCRIPTOR_HINT}`),
  parent: z.string().optional().describe('Only subtasks of this task id.'),
  unfiled: z
    .boolean()
    .optional()
    .describe('Only tasks in no project and no program — the triage queue.'),
  blocked: z
    .boolean()
    .optional()
    .describe('Only tasks with at least one dependency that has not finished.'),
  blocking: z.boolean().optional().describe('Only tasks that something else is waiting on.'),
  dueBefore: z.iso.date().optional().describe('Only tasks due on or before this `YYYY-MM-DD`.'),
  dueAfter: z.iso.date().optional().describe('Only tasks due on or after this `YYYY-MM-DD`.'),
  updatedAfter: z.iso.datetime().optional().describe('Only work changed at or after this instant.'),
  archived: z
    .boolean()
    .optional()
    .describe('List archived work instead of active work. Defaults to false.'),
};

/**
 * One row of the result, uniform enough for a caller to render without switching on entity.
 *
 * @remarks
 * Declared as the schema and inferred into the type, rather than written twice — the tool's
 * `outputSchema` is this exact object, so a field added here reaches the wire contract
 * automatically instead of drifting until someone notices.
 *
 * Ids are plain strings rather than branded: these values come straight off a primary key, so
 * re-validating each one per row buys nothing a caller can act on.
 */
export const WorkRow = z.object({
  id: z.string().describe('The entity id.'),
  title: z.string().describe('Its name or title.'),
  href: z.string().describe('Where it lives in the product app.'),
  state: z.string().optional().describe("A task's workflow state."),
  stateType: WorkflowStateType.optional().describe(
    'The canonical category `state` maps onto. Workflow states are per-team and renameable, so this — not `state` — is what compares across teams and what a status glyph is keyed off. Absent when the owning team no longer lists that state key.',
  ),
  status: z.string().optional().describe("A project, program, or initiative's status."),
  assigneeId: z.string().optional().describe('Who is accountable, when set.'),
  projectId: z.string().optional().describe('The project it belongs to, when set.'),
  assignee: z.string().optional().describe("The assignee's name."),
  project: z.string().optional().describe('The name of the project it belongs to.'),
  parent: z.string().optional().describe('The title of the task it hangs under, when it has one.'),
  cycle: z
    .string()
    .optional()
    .describe('The cycle it is committed to, named the way a team says it.'),
  dueDate: z.string().optional().describe("A task's due date, as an ISO day."),
  startDate: z.string().nullable().optional().describe("A project's planned start date."),
  startDateResolution: DateResolution.nullable()
    .optional()
    .describe("A project's broad start resolution, or null for an exact day."),
  startDateFiscalYearStartMonth: z.number().int().min(0).max(11).nullable().optional(),
  targetDate: z.string().nullable().optional().describe("A project or initiative's target date."),
  targetDateResolution: DateResolution.nullable()
    .optional()
    .describe('The broad target resolution, or null for an exact day.'),
  targetDateFiscalYearStartMonth: z.number().int().min(0).max(11).nullable().optional(),
});
/** One listed row. */
export type WorkRow = z.infer<typeof WorkRow>;

/** One filter's name. */
export type FilterName = keyof typeof listWorkFilters;

/**
 * The filters a caller supplied, before resolution.
 *
 * @remarks
 * Inferred from {@link listWorkFilters} rather than restated, so the query body reads the same
 * types the schema validates. An earlier draft typed every field `unknown` and paid for it with a
 * `typeof` guard on each of twenty branches.
 */
export type ListWorkInput = z.infer<z.ZodObject<typeof listWorkFilters>>;

/**
 * Reject a filter the requested entity has no column for.
 *
 * @param entity - What was being listed.
 * @param field - The offending filter.
 * @returns never; always throws.
 */
export function unsupported(entity: WorkEntity, field: string): never {
  throw new ValidationError(
    new z.ZodError([
      {
        code: 'invalid_value',
        path: [field],
        message: `${entity} does not support the "${field}" filter.`,
        values: [...SUPPORTED[entity]],
        input: field,
      },
    ]),
  );
}

/** Reject every supplied filter the entity cannot honor, so nothing is silently dropped. */
export function assertApplicable(entity: WorkEntity, input: ListWorkInput): void {
  const allowed = new Set<FilterName>(SUPPORTED[entity]);
  // Iterating the schema's keys rather than the payload's keeps `field` typed, and means an
  // unknown key the validator already rejected cannot reach here at all.
  for (const field of Object.keys(listWorkFilters) as FilterName[]) {
    if (input[field] === undefined) continue;
    if (!allowed.has(field)) unsupported(entity, field);
  }
}

/**
 * Match an enum column against any of `values`, tolerating an empty list.
 *
 * @remarks
 * Cast to text so a value the enum does not contain is a zero-row match rather than a Postgres
 * cast error — an agent guessing "shipped" should get nothing back, not a 500.
 */
export function anyValue(column: AnyPgColumn, values: readonly string[]): SQL | undefined {
  return values.length > 0 ? inArray(sql`${column}::text`, [...values]) : undefined;
}

/** The ISO day of a stored date, which is what a due date means and all a reader needs. */
export function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** One page of rows, as every `list_work` query returns them. */
export type WorkPageRow = WorkRow & { createdAt: Date };

/** One `list_work` call, as the per-entity queries receive it. */
export interface ListWorkQuery {
  readonly orgId: string;
  readonly actorId: string;
  readonly entity: WorkEntity;
  readonly input: ListWorkInput;
  /** Page size. */
  readonly limit: number;
  /** The keyset position from the cursor, when paging. */
  readonly after: WorkCursor | undefined;
}

/** A `list_work` call already known to be for a container rather than a task. */
export interface ContainerQuery extends Omit<ListWorkQuery, 'entity'> {
  readonly entity: Exclude<WorkEntity, 'task'>;
}
