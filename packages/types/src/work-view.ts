/**
 * Typed contracts and transport schemas for server-executed work views.
 *
 * @remarks
 * Field declarations are the source of truth for filter operands, sort keys, group keys,
 * displayed properties, runtime validation, SQL compiler registries, and renderer registries.
 */
import { z } from 'zod';

import {
  canonicalizeFilter,
  createFilterNodeSchema,
  defineViewContract,
  VIEW_LAYOUTS,
  type DisplayableFieldKey,
  type FieldOperandFor,
  type FieldValueFor,
  type FilterableFieldKey,
  type FilterNodeFor,
  type GroupableFieldKey,
  type LayoutFor,
  type MutableGroupKey,
  type SortableFieldKey,
  type ViewArrangementFor,
  type ViewContract,
  type ViewDefinitionFor,
  type ViewPresentationFor,
  type ViewTarget,
} from '@docket/work/view-contract';

import { Health, Priority, Visibility } from './capability';
import { InitiativePriority, InitiativeUpdateCadence } from './initiative';
import { ActorOut } from './actor';
import { EntityDisplayOut } from './entity-display';
import {
  ActorId,
  CycleId,
  DateString,
  Id,
  InitiativeId,
  LabelId,
  MilestoneId,
  OrganizationId,
  ProgramId,
  ProjectId,
  SavedViewId,
  TaskId,
  TeamId,
  TimestampString,
} from './primitives';

/** A Task status key that cannot be exchanged with another target's status key. */
export const TaskStatusKey = z.string().min(1).brand<'TaskStatusKey'>();
/** A validated Task status key. */
export type TaskStatusKey = z.infer<typeof TaskStatusKey>;

/** A Project status key that cannot be exchanged with another target's status key. */
export const ProjectStatusKey = z.string().min(1).brand<'ProjectStatusKey'>();
/** A validated Project status key. */
export type ProjectStatusKey = z.infer<typeof ProjectStatusKey>;

/** A Program status key that cannot be exchanged with another target's status key. */
export const ProgramStatusKey = z.string().min(1).brand<'ProgramStatusKey'>();
/** A validated Program status key. */
export type ProgramStatusKey = z.infer<typeof ProgramStatusKey>;

/** An Initiative status key that cannot be exchanged with another target's status key. */
export const InitiativeStatusKey = z.string().min(1).brand<'InitiativeStatusKey'>();
/** A validated Initiative status key. */
export type InitiativeStatusKey = z.infer<typeof InitiativeStatusKey>;

/** A literal actor operand for filters that may also refer to the current viewer. */
export const LiteralActorOperand = z
  .object({ kind: z.literal('actor'), actorId: ActorId })
  .strict();
/** A symbolic actor operand resolved against the authenticated request. */
export const CurrentActorOperand = z.object({ kind: z.literal('current-actor') }).strict();
/** An actor filter operand that remains symbolic until query execution. */
export const ActorOperand = z.discriminatedUnion('kind', [
  LiteralActorOperand,
  CurrentActorOperand,
]);
/** A validated actor filter operand. */
export type ActorOperand = z.infer<typeof ActorOperand>;

/** An absolute calendar-day operand. */
export const AbsoluteDateOperand = z
  .object({ kind: z.literal('absolute'), value: z.iso.date() })
  .strict();

/** A relative calendar range resolved in the viewer's timezone by the server. */
export const RelativeDateOperand = z
  .object({
    kind: z.literal('relative'),
    anchor: z.enum(['today', 'now']),
    unit: z.enum(['day', 'week', 'month', 'quarter', 'year']),
    offset: z.number().int(),
  })
  .strict();

/** A named relative calendar range resolved in the viewer's timezone by the server. */
export const PresetDateOperand = z
  .object({
    kind: z.literal('preset'),
    value: z.enum([
      'today',
      'yesterday',
      'tomorrow',
      'this-week',
      'next-week',
      'last-week',
      'this-month',
      'next-month',
      'last-month',
    ]),
  })
  .strict();

/** A date filter operand that does not depend on the server's current clock until execution. */
export const DateOperand = z.discriminatedUnion('kind', [
  AbsoluteDateOperand,
  RelativeDateOperand,
  PresetDateOperand,
]);
/** A validated date filter operand. */
export type DateOperand = z.infer<typeof DateOperand>;

/** A timestamp filter operand with the same symbolic date ranges as calendar fields. */
export const TimestampOperand = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absolute'), value: TimestampString }).strict(),
  RelativeDateOperand,
  PresetDateOperand,
]);

/** A validated fractional rank used for shared manual ordering. */
export const FractionalRank = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*$/)
  .brand<'FractionalRank'>();
/** A validated fractional rank. */
export type FractionalRank = z.infer<typeof FractionalRank>;

declare const viewCursorTarget: unique symbol;

/** An opaque keyset cursor validated before target-specific decoding. */
export const ViewCursorValue = z.string().brand<'ViewCursor'>();
/** An opaque cursor tied to one target by the type system. */
export type ViewCursor<E extends ViewTarget> = z.infer<typeof ViewCursorValue> & {
  readonly [viewCursorTarget]: E;
};

declare const canonicalViewTarget: unique symbol;

/** A stable fingerprint of a canonical executable view query. */
export const CanonicalViewQuery = z
  .string()
  .regex(/^sha256:[0-9a-f]{16,64}$/)
  .brand<'CanonicalViewQuery'>();
/** A canonical query fingerprint tied to one target by the type system. */
export type CanonicalViewQuery<E extends ViewTarget> = z.infer<typeof CanonicalViewQuery> & {
  readonly [canonicalViewTarget]: E;
};

/** A stable key for one built-in or saved view instance. */
export const ViewInstanceKey = z
  .string()
  .regex(
    /^(?:builtin:(?:task|project|program|initiative):[0-9A-HJKMNP-TV-Z]{26}|saved:[0-9A-HJKMNP-TV-Z]{26})$/,
  )
  .brand<'ViewInstanceKey'>();
/** A validated view-instance key. */
export type ViewInstanceKey = z.infer<typeof ViewInstanceKey>;

const nullableActor = ActorId.nullable();
const nullableDate = DateString.nullable();
const nullableTimestamp = TimestampString.nullable();
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);

/** The closed Task field catalog. */
export const TASK_VIEW_CONTRACT = defineViewContract({
  target: 'task',
  fields: {
    status: {
      kind: 'enum',
      schema: TaskStatusKey,
      capabilities: { filter: true, sort: true, group: true, display: true, mutateGroup: true },
    },
    priority: {
      kind: 'enum',
      schema: Priority,
      capabilities: { filter: true, sort: true, group: true, display: true, mutateGroup: true },
    },
    assignee: {
      kind: 'relation-one',
      schema: nullableActor,
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    delegate: {
      kind: 'relation-one',
      schema: nullableActor,
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    team: {
      kind: 'relation-one',
      schema: TeamId,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    project: {
      kind: 'relation-one',
      schema: ProjectId.nullable(),
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    program: {
      kind: 'relation-one',
      schema: ProgramId.nullable(),
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    cycle: {
      kind: 'relation-one',
      schema: CycleId.nullable(),
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    milestone: {
      kind: 'relation-one',
      schema: MilestoneId.nullable(),
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    parent: {
      kind: 'relation-one',
      schema: TaskId.nullable(),
      capabilities: { filter: true, display: true },
    },
    labels: {
      kind: 'relation-many',
      schema: z.array(LabelId),
      operandSchema: LabelId,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    title: {
      kind: 'text',
      schema: z.string(),
      capabilities: { filter: true, sort: true, display: true },
    },
    creator: {
      kind: 'relation-one',
      schema: nullableActor,
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true },
    },
    startDate: {
      kind: 'date',
      schema: nullableDate,
      operandSchema: DateOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    dueDate: {
      kind: 'date',
      schema: nullableDate,
      operandSchema: DateOperand,
      capabilities: { filter: true, sort: true, group: true, display: true },
    },
    createdAt: {
      kind: 'datetime',
      schema: TimestampString,
      operandSchema: TimestampOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    updatedAt: {
      kind: 'datetime',
      schema: TimestampString,
      operandSchema: TimestampOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    estimate: {
      kind: 'number',
      schema: z.number().int().nonnegative().nullable(),
      capabilities: { filter: true, sort: true, group: true, display: true },
    },
    estimateMinutes: {
      kind: 'number',
      schema: z.number().int().nonnegative().nullable(),
      capabilities: { filter: true, sort: true, display: true },
    },
    blocked: {
      kind: 'boolean',
      schema: z.boolean(),
      capabilities: { filter: true, sort: true, display: true },
    },
    blocking: {
      kind: 'boolean',
      schema: z.boolean(),
      capabilities: { filter: true, sort: true, display: true },
    },
    unfiled: {
      kind: 'boolean',
      schema: z.boolean(),
      capabilities: { filter: true },
    },
    archived: {
      kind: 'boolean',
      schema: z.boolean(),
      capabilities: { filter: true, sort: true, display: true },
    },
  },
});

/** The closed Project field catalog. */
export const PROJECT_VIEW_CONTRACT = defineViewContract({
  target: 'project',
  fields: {
    status: {
      kind: 'enum',
      schema: ProjectStatusKey,
      capabilities: { filter: true, sort: true, group: true, display: true, mutateGroup: true },
    },
    priority: {
      kind: 'enum',
      schema: Priority,
      capabilities: { filter: true, sort: true, group: true, display: true, mutateGroup: true },
    },
    health: {
      kind: 'enum',
      schema: Health.nullable(),
      capabilities: { filter: true, sort: true, group: true, display: true },
    },
    lead: {
      kind: 'relation-one',
      schema: nullableActor,
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    members: {
      kind: 'relation-many',
      schema: z.array(ActorId),
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true },
    },
    teams: {
      kind: 'relation-many',
      schema: z.array(TeamId),
      operandSchema: TeamId,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    program: {
      kind: 'relation-one',
      schema: ProgramId.nullable(),
      capabilities: { filter: true, group: true, display: true },
    },
    initiatives: {
      kind: 'relation-many',
      schema: z.array(InitiativeId),
      operandSchema: InitiativeId,
      capabilities: { filter: true, group: true, display: true },
    },
    labels: {
      kind: 'relation-many',
      schema: z.array(LabelId),
      operandSchema: LabelId,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    startDate: {
      kind: 'date',
      schema: nullableDate,
      operandSchema: DateOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    targetDate: {
      kind: 'date',
      schema: nullableDate,
      operandSchema: DateOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    targetTimeframe: {
      kind: 'enum',
      schema: z
        .object({
          key: z.string().min(1),
          label: z.string().min(1),
        })
        .strict()
        .nullable(),
      capabilities: { group: true, display: true },
    },
    creator: {
      kind: 'relation-one',
      schema: nullableActor,
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true },
    },
    createdAt: {
      kind: 'datetime',
      schema: TimestampString,
      operandSchema: TimestampOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    updatedAt: {
      kind: 'datetime',
      schema: TimestampString,
      operandSchema: TimestampOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    progress: {
      kind: 'number',
      schema: ratio,
      capabilities: { filter: true, sort: true, display: true },
    },
    taskCount: {
      kind: 'number',
      schema: count,
      capabilities: { filter: true, sort: true, display: true },
    },
    dependencyCount: {
      kind: 'number',
      schema: count,
      capabilities: { filter: true, sort: true, display: true },
    },
    name: {
      kind: 'text',
      schema: z.string(),
      capabilities: { filter: true, sort: true, display: true },
    },
  },
});

/** The closed Program field catalog. */
export const PROGRAM_VIEW_CONTRACT = defineViewContract({
  target: 'program',
  fields: {
    status: {
      kind: 'enum',
      schema: ProgramStatusKey,
      capabilities: { filter: true, sort: true, group: true, display: true, mutateGroup: true },
    },
    health: {
      kind: 'enum',
      schema: Health.nullable(),
      capabilities: { filter: true, sort: true, group: true, display: true },
    },
    owner: {
      kind: 'relation-one',
      schema: nullableActor,
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    initiatives: {
      kind: 'relation-many',
      schema: z.array(InitiativeId),
      operandSchema: InitiativeId,
      capabilities: { filter: true, group: true, display: true },
    },
    labels: {
      kind: 'relation-many',
      schema: z.array(LabelId),
      operandSchema: LabelId,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    visibility: {
      kind: 'enum',
      schema: Visibility,
      capabilities: { filter: true, sort: true, group: true, display: true },
    },
    creator: {
      kind: 'relation-one',
      schema: nullableActor,
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true },
    },
    updatedAt: {
      kind: 'datetime',
      schema: TimestampString,
      operandSchema: TimestampOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    projectCount: {
      kind: 'number',
      schema: count,
      capabilities: { filter: true, sort: true, display: true },
    },
    taskCount: {
      kind: 'number',
      schema: count,
      capabilities: { filter: true, sort: true, display: true },
    },
    name: {
      kind: 'text',
      schema: z.string(),
      capabilities: { filter: true, sort: true, display: true },
    },
  },
});

/** The closed Initiative field catalog. */
export const INITIATIVE_VIEW_CONTRACT = defineViewContract({
  target: 'initiative',
  fields: {
    status: {
      kind: 'enum',
      schema: InitiativeStatusKey,
      capabilities: { filter: true, sort: true, group: true, display: true, mutateGroup: true },
    },
    priority: {
      kind: 'enum',
      schema: InitiativePriority,
      capabilities: { filter: true, sort: true, group: true, display: true, mutateGroup: true },
    },
    health: {
      kind: 'enum',
      schema: Health.nullable(),
      capabilities: { filter: true, sort: true, group: true, display: true },
    },
    owner: {
      kind: 'relation-one',
      schema: nullableActor,
      operandSchema: ActorOperand,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    leadTeam: {
      kind: 'relation-one',
      schema: TeamId.nullable(),
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    labels: {
      kind: 'relation-many',
      schema: z.array(LabelId),
      operandSchema: LabelId,
      capabilities: { filter: true, group: true, display: true, mutateGroup: true },
    },
    targetDate: {
      kind: 'date',
      schema: nullableDate,
      operandSchema: DateOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    updateCadence: {
      kind: 'enum',
      schema: InitiativeUpdateCadence,
      capabilities: { filter: true, sort: true, group: true, display: true },
    },
    latestUpdate: {
      kind: 'datetime',
      schema: nullableTimestamp,
      operandSchema: TimestampOperand,
      capabilities: { filter: true, sort: true, display: true },
    },
    parent: {
      kind: 'relation-one',
      schema: InitiativeId.nullable(),
      capabilities: { filter: true, display: true },
    },
    organization: {
      kind: 'relation-one',
      schema: OrganizationId,
      capabilities: { filter: true, group: true, display: true },
    },
    name: {
      kind: 'text',
      schema: z.string(),
      capabilities: { filter: true, sort: true, display: true },
    },
  },
});

function enumValues(values: readonly string[], label: string): [string, ...string[]] {
  if (values.length === 0) throw new TypeError(`${label} requires at least one value.`);
  return values as [string, ...string[]];
}

/** Build a strict runtime schema from a literal work-view contract. */
export function createViewDefinitionSchema<const TContract extends ViewContract>(
  contract: TContract,
): z.ZodType<ViewDefinitionFor<TContract>, ViewDefinitionFor<TContract>> {
  const groupFields = Object.entries(contract.fields)
    .filter(([, field]) => field.capabilities.group === true)
    .map(([key]) => key);
  const sortFields = Object.entries(contract.fields)
    .filter(([, field]) => field.capabilities.sort === true)
    .map(([key]) => key);
  const displayFields = Object.entries(contract.fields)
    .filter(([, field]) => field.capabilities.display === true)
    .map(([key]) => key);
  const filter = createFilterNodeSchema(contract);

  return z
    .object({
      version: z.literal(2),
      target: z.literal(contract.target),
      filter: filter.nullable(),
      arrangement: z
        .object({
          groupBy: z.enum(enumValues(groupFields, 'Group fields')).nullable(),
          subGroupBy: z.enum(enumValues(groupFields, 'Subgroup fields')).nullable(),
          orderBy: z.array(
            z
              .object({
                field: z.enum(enumValues(sortFields, 'Sort fields')),
                direction: z.enum(['asc', 'desc']),
              })
              .strict(),
          ),
        })
        .strict()
        .refine(
          ({ groupBy, subGroupBy }) => groupBy === null || groupBy !== subGroupBy,
          'A subgroup must differ from the primary group.',
        ),
      presentation: z
        .object({
          layout: z.enum(VIEW_LAYOUTS),
          properties: z.array(z.enum(enumValues(displayFields, 'Display fields'))),
          density: z.enum(['comfortable', 'compact']),
          showEmptyGroups: z.boolean(),
        })
        .strict(),
    })
    .strict() as unknown as z.ZodType<ViewDefinitionFor<TContract>, ViewDefinitionFor<TContract>>;
}

/** Runtime schema for a Task view definition. */
export const TaskViewDefinition = createViewDefinitionSchema(TASK_VIEW_CONTRACT);
/** A validated Task view definition. */
export type TaskViewDefinition = ViewDefinitionFor<typeof TASK_VIEW_CONTRACT>;

/** Runtime schema for a Project view definition. */
export const ProjectViewDefinition = createViewDefinitionSchema(PROJECT_VIEW_CONTRACT);
/** A validated Project view definition. */
export type ProjectViewDefinition = ViewDefinitionFor<typeof PROJECT_VIEW_CONTRACT>;

/** Runtime schema for a Program view definition. */
export const ProgramViewDefinition = createViewDefinitionSchema(PROGRAM_VIEW_CONTRACT);
/** A validated Program view definition. */
export type ProgramViewDefinition = ViewDefinitionFor<typeof PROGRAM_VIEW_CONTRACT>;

/** Runtime schema for an Initiative view definition. */
export const InitiativeViewDefinition = createViewDefinitionSchema(INITIATIVE_VIEW_CONTRACT);
/** A validated Initiative view definition. */
export type InitiativeViewDefinition = ViewDefinitionFor<typeof INITIATIVE_VIEW_CONTRACT>;

const OrganizationWorkViewContext = z.object({ kind: z.literal('organization') }).strict();
const TeamWorkViewContext = z.object({ kind: z.literal('team'), teamId: TeamId }).strict();
const ProjectIdWorkViewContext = z
  .object({ kind: z.literal('project'), projectId: ProjectId })
  .strict();
const ProgramIdWorkViewContext = z
  .object({ kind: z.literal('program'), programId: ProgramId })
  .strict();
const InitiativeWorkViewContext = z
  .object({ kind: z.literal('initiative'), initiativeId: InitiativeId })
  .strict();

/** Contexts that may constrain a Task view. */
export const TaskWorkViewContext = z.discriminatedUnion('kind', [
  OrganizationWorkViewContext,
  TeamWorkViewContext,
  ProjectIdWorkViewContext,
  ProgramIdWorkViewContext,
  InitiativeWorkViewContext,
]);

/** Contexts that may constrain a Project view. */
export const ProjectWorkViewContext = z.discriminatedUnion('kind', [
  OrganizationWorkViewContext,
  TeamWorkViewContext,
  ProgramIdWorkViewContext,
  InitiativeWorkViewContext,
]);

/** Contexts that may constrain a Program view. */
export const ProgramWorkViewContext = z.discriminatedUnion('kind', [
  OrganizationWorkViewContext,
  InitiativeWorkViewContext,
]);

/** Contexts that may constrain an Initiative hierarchy view. */
export const InitiativeHierarchyWorkViewContext = z.discriminatedUnion('kind', [
  OrganizationWorkViewContext,
  InitiativeWorkViewContext,
]);

/** A contextual boundary applied before saved and temporary filters. */
export const WorkViewContext = z.discriminatedUnion('kind', [
  OrganizationWorkViewContext,
  TeamWorkViewContext,
  ProjectIdWorkViewContext,
  ProgramIdWorkViewContext,
  InitiativeWorkViewContext,
]);
/** A validated contextual boundary. */
export type WorkViewContext = z.infer<typeof WorkViewContext>;

function queryRequest<const TContract extends ViewContract, const TContext extends z.ZodType>(
  contract: TContract,
  definition: z.ZodType<ViewDefinitionFor<TContract>, ViewDefinitionFor<TContract>>,
  context: TContext,
) {
  const organizationContext = context.parse({ kind: 'organization' });
  return z
    .object({
      target: z.literal(contract.target),
      definition,
      temporaryFilter: createFilterNodeSchema(contract).nullable().default(null),
      context: context.default(organizationContext as never),
      search: z.string().trim().min(1).optional(),
      groupPath: z.array(z.string()).max(2).optional(),
      cursor: ViewCursorValue.nullable().optional(),
      limit: z.number().int().min(1).max(100).default(100),
    })
    .strict();
}

/** Task query request body. */
export const TaskWorkViewQueryRequest = queryRequest(
  TASK_VIEW_CONTRACT,
  TaskViewDefinition,
  TaskWorkViewContext,
);
/** Project query request body. */
export const ProjectWorkViewQueryRequest = queryRequest(
  PROJECT_VIEW_CONTRACT,
  ProjectViewDefinition,
  ProjectWorkViewContext,
);
/** Program query request body. */
export const ProgramWorkViewQueryRequest = queryRequest(
  PROGRAM_VIEW_CONTRACT,
  ProgramViewDefinition,
  ProgramWorkViewContext,
);
/** Initiative query request body. */
export const InitiativeWorkViewQueryRequest = queryRequest(
  INITIATIVE_VIEW_CONTRACT,
  InitiativeViewDefinition,
  InitiativeHierarchyWorkViewContext,
);

/** Target-discriminated request body for the server work-view query operation. */
export const WorkViewQueryRequest = z.discriminatedUnion('target', [
  TaskWorkViewQueryRequest,
  ProjectWorkViewQueryRequest,
  ProgramWorkViewQueryRequest,
  InitiativeWorkViewQueryRequest,
]);
/** A validated work-view query request. */
export type WorkViewQueryRequest = z.infer<typeof WorkViewQueryRequest>;

/** Facet request derived from one target contract. */
export interface WorkViewFacetRequestFor<TContract extends ViewContract, TContext> {
  readonly target: TContract['target'];
  readonly fields: readonly [FilterableFieldKey<TContract>];
  readonly definition: ViewDefinitionFor<TContract>;
  readonly temporaryFilter: FilterNodeFor<TContract> | null;
  readonly context: TContext;
  readonly search?: string;
  readonly cursor?: string;
  readonly limit: number;
}

/** Wire input for a facet request before Zod applies context and paging defaults. */
export type WorkViewFacetRequestInputFor<TContract extends ViewContract, TContext> = Omit<
  WorkViewFacetRequestFor<TContract, TContext>,
  'temporaryFilter' | 'context' | 'limit'
> & {
  readonly temporaryFilter?: FilterNodeFor<TContract> | null;
  readonly context?: TContext;
  readonly limit?: number;
};

function facetRequest<const TContract extends ViewContract, const TContext extends z.ZodType>(
  contract: TContract,
  definition: z.ZodType<ViewDefinitionFor<TContract>, ViewDefinitionFor<TContract>>,
  context: TContext,
): z.ZodType<
  WorkViewFacetRequestFor<TContract, z.output<TContext>>,
  WorkViewFacetRequestInputFor<TContract, z.input<TContext>>
> {
  const organizationContext = context.parse({ kind: 'organization' });
  const fields = Object.entries(contract.fields)
    .filter(([, field]) => field.capabilities.filter === true)
    .map(([key]) => key);
  return z
    .object({
      target: z.literal(contract.target),
      fields: z.array(z.enum(enumValues(fields, 'Facet fields'))).length(1),
      definition,
      temporaryFilter: createFilterNodeSchema(contract).nullable().default(null),
      context: context.default(organizationContext as never),
      search: z.string().trim().min(1).optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict() as unknown as z.ZodType<
    WorkViewFacetRequestFor<TContract, z.output<TContext>>,
    WorkViewFacetRequestInputFor<TContract, z.input<TContext>>
  >;
}

/** Facet request for Task fields. */
export const TaskWorkViewFacetRequest = facetRequest(
  TASK_VIEW_CONTRACT,
  TaskViewDefinition,
  TaskWorkViewContext,
);
/** Facet request for Project fields. */
export const ProjectWorkViewFacetRequest = facetRequest(
  PROJECT_VIEW_CONTRACT,
  ProjectViewDefinition,
  ProjectWorkViewContext,
);
/** Facet request for Program fields. */
export const ProgramWorkViewFacetRequest = facetRequest(
  PROGRAM_VIEW_CONTRACT,
  ProgramViewDefinition,
  ProgramWorkViewContext,
);
/** Facet request for Initiative fields. */
export const InitiativeWorkViewFacetRequest = facetRequest(
  INITIATIVE_VIEW_CONTRACT,
  InitiativeViewDefinition,
  InitiativeHierarchyWorkViewContext,
);

/** Target-discriminated request for option counts and searchable relation facets. */
export const WorkViewFacetRequest = z.union([
  TaskWorkViewFacetRequest,
  ProjectWorkViewFacetRequest,
  ProgramWorkViewFacetRequest,
  InitiativeWorkViewFacetRequest,
]);
/** A validated work-view facet request. */
export type WorkViewFacetRequest = z.infer<typeof WorkViewFacetRequest>;

/** One field-specific option bucket returned by the facet operation. */
export type WorkViewFacetBucketFor<TContract extends ViewContract> = {
  [TField in FilterableFieldKey<TContract>]: {
    readonly field: TField;
    readonly options: readonly {
      readonly value: FieldOperandFor<TContract, TField>;
      readonly label: string;
      readonly count: number;
    }[];
    readonly emptyCount: number;
    readonly nextCursor: string | null;
  };
}[FilterableFieldKey<TContract>];

/** Facet result derived from one target contract. */
export interface WorkViewFacetResponseFor<TContract extends ViewContract> {
  readonly target: TContract['target'];
  readonly buckets: readonly WorkViewFacetBucketFor<TContract>[];
  readonly distinctCount: number;
}

function facetResponse<const TContract extends ViewContract>(
  contract: TContract,
): z.ZodType<WorkViewFacetResponseFor<TContract>> {
  const variants: z.ZodObject<z.ZodRawShape>[] = [];
  for (const [fieldKey, field] of Object.entries(contract.fields)) {
    /* v8 ignore next -- @preserve current contracts expose facets for every declared field. */
    if (field.capabilities.filter !== true) continue;
    variants.push(
      z
        .object({
          field: z.literal(fieldKey),
          options: z.array(
            z
              .object({
                value: field.operandSchema ?? field.schema,
                label: z.string(),
                count,
              })
              .strict(),
          ),
          emptyCount: count,
          nextCursor: z.string().nullable(),
        })
        .strict(),
    );
  }
  return z
    .object({
      target: z.literal(contract.target),
      buckets: z.array(
        z.union(variants as [z.ZodObject<z.ZodRawShape>, z.ZodObject<z.ZodRawShape>]),
      ),
      distinctCount: count,
    })
    .strict() as unknown as z.ZodType<WorkViewFacetResponseFor<TContract>>;
}

/** Typed Task facet result. */
export const TaskWorkViewFacetResponse = facetResponse(TASK_VIEW_CONTRACT);
/** Typed Project facet result. */
export const ProjectWorkViewFacetResponse = facetResponse(PROJECT_VIEW_CONTRACT);
/** Typed Program facet result. */
export const ProgramWorkViewFacetResponse = facetResponse(PROGRAM_VIEW_CONTRACT);
/** Typed Initiative facet result. */
export const InitiativeWorkViewFacetResponse = facetResponse(INITIATIVE_VIEW_CONTRACT);

/** Target-discriminated option counts and searchable relation facets. */
export const WorkViewFacetResponse = z.union([
  TaskWorkViewFacetResponse,
  ProjectWorkViewFacetResponse,
  ProgramWorkViewFacetResponse,
  InitiativeWorkViewFacetResponse,
]);
/** A validated work-view facet response. */
export type WorkViewFacetResponse = z.infer<typeof WorkViewFacetResponse>;

type RelationManyMutableGroupKey<TContract extends ViewContract> = {
  [
    TField in MutableGroupKey<TContract>
  ]: TContract['fields'][TField]['kind'] extends 'relation-many' ? TField : never;
}[MutableGroupKey<TContract>];

type ScalarMutableGroupKey<TContract extends ViewContract> = Exclude<
  MutableGroupKey<TContract>,
  RelationManyMutableGroupKey<TContract>
>;

type WorkViewOrderFor<TContract extends ViewContract, TId, TContext> =
  | {
      readonly target: TContract['target'];
      readonly itemId: TId;
      readonly context: TContext;
      readonly groupField: null;
      readonly groupValue: null;
      readonly beforeId: TId | null;
      readonly afterId: TId | null;
    }
  | {
      [TField in ScalarMutableGroupKey<TContract>]: {
        readonly target: TContract['target'];
        readonly itemId: TId;
        readonly context: TContext;
        readonly groupField: TField;
        readonly groupValue: null extends FieldValueFor<TContract, TField>
          ? FieldOperandFor<TContract, TField> | null
          : FieldOperandFor<TContract, TField>;
        readonly beforeId: TId | null;
        readonly afterId: TId | null;
      };
    }[ScalarMutableGroupKey<TContract>]
  | {
      [TField in RelationManyMutableGroupKey<TContract>]: {
        readonly target: TContract['target'];
        readonly itemId: TId;
        readonly context: TContext;
        readonly groupField: TField;
        readonly sourceGroupValue: FieldOperandFor<TContract, TField> | null;
        readonly groupValue: FieldOperandFor<TContract, TField> | null;
        readonly beforeId: TId | null;
        readonly afterId: TId | null;
      };
    }[RelationManyMutableGroupKey<TContract>];

type WorkViewOrderInputFor<TContract extends ViewContract, TId, TContext> =
  WorkViewOrderFor<TContract, TId, TContext> extends infer TRequest
    ? TRequest extends { readonly context: TContext }
      ? Omit<TRequest, 'context'> & { readonly context?: TContext }
      : never
    : never;

function orderRequest<
  const TContract extends ViewContract,
  const TId extends z.ZodType,
  const TContext extends z.ZodType,
>(
  contract: TContract,
  itemId: TId,
  context: TContext,
): z.ZodType<
  WorkViewOrderFor<TContract, z.output<TId>, z.output<TContext>>,
  WorkViewOrderInputFor<TContract, z.input<TId>, z.input<TContext>>
> {
  const organizationContext = context.parse({ kind: 'organization' });
  const variants: z.ZodObject<z.ZodRawShape>[] = [];
  for (const [groupField, field] of Object.entries(contract.fields)) {
    if (field.capabilities.mutateGroup !== true) continue;
    const operand = field.operandSchema ?? field.schema;
    if (field.kind === 'relation-many') {
      variants.push(
        z
          .object({
            target: z.literal(contract.target),
            itemId,
            context: context.default(organizationContext as never),
            groupField: z.literal(groupField),
            sourceGroupValue: operand.nullable(),
            groupValue: operand.nullable(),
            beforeId: itemId.nullable(),
            afterId: itemId.nullable(),
          })
          .strict(),
      );
      continue;
    }
    const groupValue = field.schema.safeParse(null).success
      ? z.union([operand, z.null()])
      : operand;
    variants.push(
      z
        .object({
          target: z.literal(contract.target),
          itemId,
          context: context.default(organizationContext as never),
          groupField: z.literal(groupField),
          groupValue,
          beforeId: itemId.nullable(),
          afterId: itemId.nullable(),
        })
        .strict(),
    );
  }
  variants.push(
    z
      .object({
        target: z.literal(contract.target),
        itemId,
        context: context.default(organizationContext as never),
        groupField: z.null(),
        groupValue: z.null(),
        beforeId: itemId.nullable(),
        afterId: itemId.nullable(),
      })
      .strict(),
  );
  return z.union(
    variants as [z.ZodObject<z.ZodRawShape>, z.ZodObject<z.ZodRawShape>],
  ) as unknown as z.ZodType<
    WorkViewOrderFor<TContract, z.output<TId>, z.output<TContext>>,
    WorkViewOrderInputFor<TContract, z.input<TId>, z.input<TContext>>
  >;
}

/** Manual or property-changing Task reorder request. */
export const TaskWorkViewOrderRequest = orderRequest(
  TASK_VIEW_CONTRACT,
  TaskId,
  TaskWorkViewContext,
);
/** Manual or property-changing Project reorder request. */
export const ProjectWorkViewOrderRequest = orderRequest(
  PROJECT_VIEW_CONTRACT,
  ProjectId,
  ProjectWorkViewContext,
);
/** Manual or property-changing Program reorder request. */
export const ProgramWorkViewOrderRequest = orderRequest(
  PROGRAM_VIEW_CONTRACT,
  ProgramId,
  ProgramWorkViewContext,
);
/** Manual or property-changing Initiative reorder request. */
export const InitiativeWorkViewOrderRequest = orderRequest(
  INITIATIVE_VIEW_CONTRACT,
  InitiativeId,
  InitiativeHierarchyWorkViewContext,
);

/** Target-discriminated manual or property-changing reorder request. */
export const WorkViewOrderRequest = z.union([
  TaskWorkViewOrderRequest,
  ProjectWorkViewOrderRequest,
  ProgramWorkViewOrderRequest,
  InitiativeWorkViewOrderRequest,
]);
/** A validated work-view reorder request. */
export type WorkViewOrderRequest = z.infer<typeof WorkViewOrderRequest>;

/** Acknowledgement for one persisted shared work-view reorder. */
export const WorkViewOrderResponse = z
  .object({
    target: z.enum(['task', 'project', 'program', 'initiative']),
    itemId: z.string(),
    rank: FractionalRank,
  })
  .strict();
/** A validated shared work-view reorder acknowledgement. */
export type WorkViewOrderResponse = z.infer<typeof WorkViewOrderResponse>;

/** A personal override that never copies the saved or workspace-default definition. */
export interface WorkViewPersonalOverride<TContract extends ViewContract> {
  /** Arrangement keys explicitly overridden by the viewer. */
  readonly arrangement?: Partial<ViewArrangementFor<TContract>>;
  /** Presentation keys explicitly overridden by the viewer. */
  readonly presentation?: Partial<ViewPresentationFor<TContract>>;
}

/** Inputs to the deterministic work-view precedence resolver. */
export interface ResolveWorkViewDefinitionInput<TContract extends ViewContract> {
  /** Product fallback used only where no saved view or workspace default supplies state. */
  readonly fallback: ViewDefinitionFor<TContract>;
  /** Saved-view or workspace-default definition. */
  readonly savedOrDefault?: ViewDefinitionFor<TContract> | null;
  /** Personal arrangement and presentation override. */
  readonly personal?: WorkViewPersonalOverride<TContract> | null;
  /** Temporary URL refinement combined with the durable filter through AND. */
  readonly temporaryFilter?: FilterNodeFor<TContract> | null;
}

/** Resolve product, durable, personal, and temporary state in their declared precedence order. */
export function resolveWorkViewDefinition<const TContract extends ViewContract>(
  input: ResolveWorkViewDefinitionInput<TContract>,
): ViewDefinitionFor<TContract> {
  const durable = input.savedOrDefault ?? input.fallback;
  const filter =
    durable.filter && input.temporaryFilter
      ? canonicalizeFilter({ kind: 'all', children: [durable.filter, input.temporaryFilter] })
      : (input.temporaryFilter ?? durable.filter);
  return {
    ...durable,
    filter,
    arrangement: { ...durable.arrangement, ...input.personal?.arrangement },
    presentation: { ...durable.presentation, ...input.personal?.presentation },
  };
}

/** Sparse personal state for one view contract. */
export interface PersonalWorkViewStateFor<TContract extends ViewContract> {
  readonly instanceKey: ViewInstanceKey;
  readonly target: TContract['target'];
  readonly arrangement?: {
    readonly groupBy?: GroupableFieldKey<TContract> | null;
    readonly subGroupBy?: GroupableFieldKey<TContract> | null;
    readonly orderBy?: readonly {
      readonly field: SortableFieldKey<TContract>;
      readonly direction: 'asc' | 'desc';
    }[];
  };
  readonly presentation?: {
    readonly layout?: LayoutFor<TContract>;
    readonly properties?: readonly DisplayableFieldKey<TContract>[];
    readonly density?: 'comfortable' | 'compact';
    readonly showEmptyGroups?: boolean;
  };
  readonly collapsedGroups: readonly string[];
  readonly hiddenBoardColumns: readonly string[];
  readonly favoriteViewIds: readonly z.infer<typeof SavedViewId>[];
  readonly lastUsedLayout?: LayoutFor<TContract>;
}

function preferenceState<const TContract extends ViewContract>(
  contract: TContract,
): z.ZodType<PersonalWorkViewStateFor<TContract>> {
  const groupFields = Object.entries(contract.fields)
    .filter(([, field]) => field.capabilities.group === true)
    .map(([key]) => key);
  const sortFields = Object.entries(contract.fields)
    .filter(([, field]) => field.capabilities.sort === true)
    .map(([key]) => key);
  const displayFields = Object.entries(contract.fields)
    .filter(([, field]) => field.capabilities.display === true)
    .map(([key]) => key);
  return z
    .object({
      instanceKey: ViewInstanceKey,
      target: z.literal(contract.target),
      arrangement: z
        .object({
          groupBy: z.enum(enumValues(groupFields, 'Preference group fields')).nullable().optional(),
          subGroupBy: z
            .enum(enumValues(groupFields, 'Preference subgroup fields'))
            .nullable()
            .optional(),
          orderBy: z
            .array(
              z
                .object({
                  field: z.enum(enumValues(sortFields, 'Preference sort fields')),
                  direction: z.enum(['asc', 'desc']),
                })
                .strict(),
            )
            .optional(),
        })
        .strict()
        .optional(),
      presentation: z
        .object({
          layout: z.enum(VIEW_LAYOUTS).optional(),
          properties: z
            .array(z.enum(enumValues(displayFields, 'Preference display fields')))
            .optional(),
          density: z.enum(['comfortable', 'compact']).optional(),
          showEmptyGroups: z.boolean().optional(),
        })
        .strict()
        .optional(),
      collapsedGroups: z.array(z.string()).default([]),
      hiddenBoardColumns: z.array(z.string()).default([]),
      favoriteViewIds: z.array(SavedViewId).default([]),
      lastUsedLayout: z.enum(VIEW_LAYOUTS).optional(),
    })
    .strict() as unknown as z.ZodType<PersonalWorkViewStateFor<TContract>>;
}

/** Personal work-view state stored in Hub preferences. */
export const PersonalWorkViewState = z.union([
  preferenceState(TASK_VIEW_CONTRACT),
  preferenceState(PROJECT_VIEW_CONTRACT),
  preferenceState(PROGRAM_VIEW_CONTRACT),
  preferenceState(INITIATIVE_VIEW_CONTRACT),
]);
/** A validated personal work-view state entry. */
export type PersonalWorkViewState = z.infer<typeof PersonalWorkViewState>;

const baseRow = {
  organizationId: OrganizationId,
  manualRank: FractionalRank,
  isContext: z.boolean().default(false),
};

/** Dated Project checkpoint retained by the timeline projection. */
export const ProjectViewMilestone = z
  .object({ id: MilestoneId, name: z.string(), targetDate: nullableDate })
  .strict();
/** A validated Project checkpoint in a work-view row. */
export type ProjectViewMilestone = z.infer<typeof ProjectViewMilestone>;

/** Contributing Project schedule retained by an Initiative timeline rollup. */
export const InitiativeContributingProject = z
  .object({
    id: ProjectId,
    name: z.string(),
    startDate: nullableDate,
    targetDate: nullableDate,
    progress: ratio,
  })
  .strict();
/** A validated contributing Project schedule in an Initiative work-view row. */
export type InitiativeContributingProject = z.infer<typeof InitiativeContributingProject>;

/** Resolved actor identity carried only to roster presentation. */
export const WorkViewActor = ActorOut.pick({
  id: true,
  kind: true,
  displayName: true,
  avatar: true,
}).strict();
/** A resolved actor identity for a work-view row. */
export type WorkViewActor = z.infer<typeof WorkViewActor>;

/** Task projection returned by the work-view query operation. */
export const TaskViewRow = z
  .object({
    ...baseRow,
    target: z.literal('task'),
    id: TaskId,
    title: z.string(),
    description: z.string().nullable().default(null),
    status: TaskStatusKey,
    priority: Priority,
    assignee: nullableActor,
    assigneeActor: WorkViewActor.nullable().default(null),
    delegate: nullableActor,
    team: TeamId,
    project: ProjectId.nullable(),
    program: ProgramId.nullable(),
    cycle: CycleId.nullable(),
    milestone: MilestoneId.nullable(),
    parent: TaskId.nullable(),
    labels: z.array(LabelId),
    creator: nullableActor,
    startDate: nullableDate,
    dueDate: nullableDate,
    createdAt: TimestampString,
    updatedAt: TimestampString,
    estimate: z.number().int().nonnegative().nullable(),
    estimateMinutes: z.number().int().nonnegative().nullable(),
    blocked: z.boolean(),
    blocking: z.boolean(),
    unfiled: z.boolean(),
    archived: z.boolean(),
  })
  .strict();
/** A validated Task work-view row. */
export type TaskViewRow = z.infer<typeof TaskViewRow>;

/** Project projection returned by the work-view query operation. */
export const ProjectViewRow = z
  .object({
    ...baseRow,
    target: z.literal('project'),
    id: ProjectId,
    name: z.string(),
    summary: z.string().nullable().default(null),
    status: ProjectStatusKey,
    priority: Priority,
    health: Health.nullable(),
    lead: nullableActor,
    leadActor: WorkViewActor.nullable().default(null),
    display: EntityDisplayOut.nullable().default(null),
    members: z.array(ActorId),
    teams: z.array(TeamId),
    program: ProgramId.nullable(),
    initiatives: z.array(InitiativeId),
    labels: z.array(LabelId),
    startDate: nullableDate,
    targetDate: nullableDate,
    targetTimeframe: z
      .object({
        key: z.string().min(1),
        label: z.string().min(1),
      })
      .strict()
      .nullable()
      .default(null),
    creator: nullableActor,
    createdAt: TimestampString,
    updatedAt: TimestampString,
    progress: ratio,
    taskCount: count,
    dependencyCount: count,
    milestones: z.array(ProjectViewMilestone).default([]),
    blockedByIds: z.array(ProjectId).default([]),
    blocksIds: z.array(ProjectId).default([]),
  })
  .strict();
/** A validated Project work-view row. */
export type ProjectViewRow = z.infer<typeof ProjectViewRow>;

/** A fixed oldest-to-newest eight-week summary of visible Program activity. */
export const ProgramActivitySummary = z
  .object({
    weeks: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    latestOccurredAt: TimestampString.nullable(),
  })
  .strict();
/** A validated fixed-window Program activity summary. */
export type ProgramActivitySummary = z.infer<typeof ProgramActivitySummary>;

/** Program projection returned by the work-view query operation. */
export const ProgramViewRow = z
  .object({
    ...baseRow,
    target: z.literal('program'),
    id: ProgramId,
    name: z.string(),
    summary: z.string().nullable().default(null),
    status: ProgramStatusKey,
    health: Health.nullable(),
    owner: nullableActor,
    ownerActor: WorkViewActor.nullable().default(null),
    initiatives: z.array(InitiativeId),
    labels: z.array(LabelId),
    visibility: Visibility,
    creator: nullableActor,
    updatedAt: TimestampString,
    projectCount: count,
    taskCount: count,
    activity: ProgramActivitySummary,
  })
  .strict();
/** A validated Program work-view row. */
export type ProgramViewRow = z.infer<typeof ProgramViewRow>;

/** Initiative projection returned by the work-view query operation. */
export const InitiativeViewRow = z
  .object({
    ...baseRow,
    target: z.literal('initiative'),
    id: InitiativeId,
    name: z.string(),
    summary: z.string().nullable().default(null),
    status: InitiativeStatusKey,
    priority: InitiativePriority,
    health: Health.nullable(),
    owner: nullableActor,
    ownerActor: WorkViewActor.nullable().default(null),
    display: EntityDisplayOut.nullable().default(null),
    leadTeam: TeamId.nullable(),
    labels: z.array(LabelId),
    targetDate: nullableDate,
    updateCadence: InitiativeUpdateCadence,
    latestUpdate: nullableTimestamp,
    updatedAt: TimestampString,
    parent: InitiativeId.nullable(),
    parentLinkId: Id.nullable().default(null),
    organization: OrganizationId,
    contributingProjects: z.array(InitiativeContributingProject).default([]),
  })
  .strict();
/** A validated Initiative work-view row. */
export type InitiativeViewRow = z.infer<typeof InitiativeViewRow>;

/** One materialized group or subgroup with a distinct matched-item count. */
export const WorkViewGroup = z
  .object({
    path: z.array(z.string()).min(1).max(2),
    key: z.string(),
    label: z.string(),
    count: count,
  })
  .strict();
/** A validated materialized group or subgroup summary. */
export type WorkViewGroup = z.infer<typeof WorkViewGroup>;

function queryResponse<const TTarget extends ViewTarget, const TRow extends z.ZodType>(
  target: TTarget,
  row: TRow,
) {
  return z
    .object({
      target: z.literal(target),
      rows: z.array(row),
      groups: z.array(WorkViewGroup),
      totalCount: count,
      nextCursor: ViewCursorValue.nullable(),
      queryFingerprint: CanonicalViewQuery,
    })
    .strict();
}

/** Target-discriminated keyset page returned by the work-view query operation. */
export const WorkViewQueryResponse = z.discriminatedUnion('target', [
  queryResponse('task', TaskViewRow),
  queryResponse('project', ProjectViewRow),
  queryResponse('program', ProgramViewRow),
  queryResponse('initiative', InitiativeViewRow),
]);
/** A validated work-view query response. */
export type WorkViewQueryResponse = z.infer<typeof WorkViewQueryResponse>;

/** One target-specific filter node accepted by query routes and saved views. */
export type AnyWorkViewFilter =
  | FilterNodeFor<typeof TASK_VIEW_CONTRACT>
  | FilterNodeFor<typeof PROJECT_VIEW_CONTRACT>
  | FilterNodeFor<typeof PROGRAM_VIEW_CONTRACT>
  | FilterNodeFor<typeof INITIATIVE_VIEW_CONTRACT>;

/** Reference to a saved view for favorites, tab order, and personal preference state. */
export const SavedWorkViewRef = z
  .object({ savedViewId: SavedViewId, instanceKey: ViewInstanceKey })
  .strict();
