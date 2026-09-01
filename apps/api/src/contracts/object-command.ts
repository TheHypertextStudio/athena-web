/**
 * `domain packages` — transactional object commands used by editable canvases.
 */
import { DateResolution } from '@docket/work/planning-timeframe';
import { z } from 'zod';

import { Health } from '@docket/work/capability-contract';
import { Priority } from '@docket/work/task-contract';
import { ActorId, TeamId } from '@docket/identity-access/ids';
import {
  CycleId,
  InitiativeId,
  LabelId,
  MilestoneId,
  ProgramId,
  ProjectId,
  TaskId,
  WorkStatusId,
} from '@docket/work/ids';
import { ProjectStatus } from './project';
import { TASK_DATE_MAX, TASK_DATE_MIN } from '@docket/work/task-model';

/**
 * Project lead transport id.
 *
 * Actor ids cannot encode kind, status, or tenant membership in their ULID. The command service
 * therefore validates that this id resolves to an active human Actor in the target organization.
 */
export const ProjectLeadActorId = ActorId.describe(
  'ULID id whose Project-lead use requires an active human Actor in the target organization; the command service enforces those semantic facts.',
);

const commandId = z.string().min(1).max(200);
/** Maximum associations one object command may add or remove in one request. */
export const OBJECT_COMMAND_ASSOCIATION_LIMIT = 20;
/** Maximum base object-relation changes one forward command may generate. */
export const OBJECT_COMMAND_GENERATED_CHANGE_LIMIT = 5_000;
/** Maximum receipt entries after exclusive-label displacement is included. */
export const OBJECT_COMMAND_RECEIPT_ENTRY_LIMIT = OBJECT_COMMAND_GENERATED_CHANGE_LIMIT * 2;
const taskDate = z.iso.date().refine((value) => value >= TASK_DATE_MIN && value <= TASK_DATE_MAX, {
  message: `Date must fall between ${TASK_DATE_MIN} and ${TASK_DATE_MAX}`,
});
const planningReceiptDate = z.iso
  .datetime()
  .refine((value) => value.slice(0, 10) >= TASK_DATE_MIN && value.slice(0, 10) <= TASK_DATE_MAX, {
    message: `Date must fall between ${TASK_DATE_MIN} and ${TASK_DATE_MAX}`,
  });
const objectIds = <T extends z.ZodType>(id: T) =>
  z
    .array(id)
    .min(1)
    .max(500)
    .superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', message: 'Object ids must be unique.' });
      }
    });

const taskPropertyOperation = z.discriminatedUnion('property', [
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('title'),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('state'),
    value: z.string().min(1).max(200),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('priority'),
    value: Priority,
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('assigneeId'),
    value: ActorId.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('projectId'),
    value: ProjectId.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('programId'),
    value: ProgramId.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('milestoneId'),
    value: MilestoneId.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('cycleId'),
    value: CycleId.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('startDate'),
    value: taskDate.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('dueDate'),
    value: taskDate.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('estimate'),
    value: z.number().int().min(0).nullable(),
  }),
]);

const projectPropertyOperation = z.discriminatedUnion('property', [
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('status'),
    value: ProjectStatus,
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('health'),
    value: Health.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('priority'),
    value: Priority,
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('leadId'),
    value: ProjectLeadActorId.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('teamId'),
    value: TeamId.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('programId'),
    value: ProgramId.nullable(),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('startTimeframe'),
    value: z.object({ date: taskDate.nullable(), resolution: DateResolution.nullable() }),
  }),
  z.object({
    type: z.literal('replace_property'),
    property: z.literal('targetTimeframe'),
    value: z.object({ date: taskDate.nullable(), resolution: DateResolution.nullable() }),
  }),
]);

const terminalOperation = z.union([
  z.object({ type: z.literal('trash') }),
  z.object({ type: z.literal('restore') }),
]);
const labelOperation = z
  .object({
    type: z.enum(['add_association', 'remove_association']),
    association: z.literal('label'),
    associationIds: z.array(LabelId).min(1).max(OBJECT_COMMAND_ASSOCIATION_LIMIT),
  })
  .superRefine((value, context) => {
    if (new Set(value.associationIds).size !== value.associationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['associationIds'],
        message: 'Association ids must be unique.',
      });
    }
  });
const projectInitiativeOperation = z
  .object({
    type: z.enum(['add_association', 'remove_association']),
    association: z.literal('initiative'),
    associationIds: z.array(InitiativeId).min(1).max(OBJECT_COMMAND_ASSOCIATION_LIMIT),
  })
  .superRefine((value, context) => {
    if (new Set(value.associationIds).size !== value.associationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['associationIds'],
        message: 'Association ids must be unique.',
      });
    }
  });
const taskDependencyOperation = z.object({
  type: z.enum(['add_dependency', 'remove_dependency']),
  blockingId: TaskId,
  blockedId: TaskId,
});
const projectDependencyOperation = z.object({
  type: z.enum(['add_dependency', 'remove_dependency']),
  blockingId: ProjectId,
  blockedId: ProjectId,
});
const hierarchyOperation = z.object({
  type: z.literal('change_parent'),
  parentId: TaskId.nullable(),
});

/** A validated forward command over one homogeneous set of Tasks or Projects. */
export const ObjectCommandIn = z
  .discriminatedUnion('objectKind', [
    z.object({
      commandId,
      objectKind: z.literal('task'),
      objectIds: objectIds(TaskId),
      operation: z.union([
        taskPropertyOperation,
        labelOperation,
        taskDependencyOperation,
        hierarchyOperation,
        terminalOperation,
      ]),
    }),
    z.object({
      commandId,
      objectKind: z.literal('project'),
      objectIds: objectIds(ProjectId),
      operation: z.union([
        projectPropertyOperation,
        labelOperation,
        projectInitiativeOperation,
        projectDependencyOperation,
        terminalOperation,
      ]),
    }),
  ])
  .superRefine((command, context) => {
    if (
      command.objectKind === 'task' &&
      command.operation.type === 'replace_property' &&
      command.operation.property === 'title' &&
      command.objectIds.length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['objectIds'],
        message: 'A Task title replacement must target exactly one Task.',
      });
    }
    if (
      !['add_association', 'remove_association'].includes(command.operation.type) ||
      !('associationIds' in command.operation)
    ) {
      return;
    }
    if (
      command.objectIds.length * command.operation.associationIds.length >
      OBJECT_COMMAND_GENERATED_CHANGE_LIMIT
    ) {
      context.addIssue({
        code: 'custom',
        path: ['operation', 'associationIds'],
        message: `One command may generate at most ${OBJECT_COMMAND_GENERATED_CHANGE_LIMIT} relation changes.`,
      });
    }
  });
/** A forward command over one homogeneous object selection. */
export type ObjectCommandIn = z.infer<typeof ObjectCommandIn>;

/** A JSON-safe scalar stored in a replay receipt. */
export const ObjectCommandValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
/** A JSON-safe scalar stored in a replay receipt. */
export type ObjectCommandValue = z.infer<typeof ObjectCommandValue>;

/** A normalized object-field change that the server can compare and replay safely. */
export const ObjectCommandObjectReceiptEntry = z.object({
  kind: z.literal('object'),
  objectId: z.string().min(1).max(200),
  property: z.string().min(1).max(100),
  before: ObjectCommandValue,
  after: ObjectCommandValue,
});

/** A normalized association or dependency edge change. */
export const ObjectCommandRelationReceiptEntry = z.object({
  kind: z.literal('relation'),
  objectId: z.string().min(1).max(200),
  relation: z.enum(['label', 'initiative', 'dependency']),
  relatedId: z.string().min(1).max(200),
  before: z.boolean(),
  after: z.boolean(),
});
/** A normalized association or dependency edge receipt entry. */
export type ObjectCommandRelationReceiptEntry = z.infer<typeof ObjectCommandRelationReceiptEntry>;

const ObjectCommandReceiptShape = z.object({
  commandId,
  objectKind: z.enum(['task', 'project']),
  action: z.enum([
    'replace_property',
    'add_association',
    'remove_association',
    'add_dependency',
    'remove_dependency',
    'change_parent',
    'trash',
    'restore',
  ]),
  entries: z
    .array(z.union([ObjectCommandObjectReceiptEntry, ObjectCommandRelationReceiptEntry]))
    .max(OBJECT_COMMAND_RECEIPT_ENTRY_LIMIT),
});

type ObjectCommandReceiptShape = z.infer<typeof ObjectCommandReceiptShape>;

function receiptEntryIdentity(entry: ObjectCommandReceiptShape['entries'][number]): string {
  return entry.kind === 'object'
    ? `${entry.objectId}:object:${entry.property}`
    : `${entry.objectId}:relation:${entry.relation}:${entry.relatedId}`;
}

function validateReceiptCardinality(
  receipt: ObjectCommandReceiptShape,
  context: z.RefinementCtx,
): void {
  const objectIds = new Set(
    receipt.entries.flatMap((entry) =>
      entry.kind === 'relation' && entry.relation === 'dependency'
        ? [entry.objectId, entry.relatedId]
        : [entry.objectId],
    ),
  );
  if (objectIds.size > 500) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'A receipt may contain at most 500 objects.',
    });
  }
  const identities = receipt.entries.map(receiptEntryIdentity);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'Receipt entries must be unique.',
    });
  }
}

function propertyCountsByObject(
  receipt: ObjectCommandReceiptShape,
  properties: readonly string[],
): Map<string, Map<string, number>> {
  const propertySet = new Set(properties);
  const countsByObject = new Map<string, Map<string, number>>();
  for (const entry of receipt.entries) {
    if (entry.kind !== 'object' || !propertySet.has(entry.property)) continue;
    const counts = countsByObject.get(entry.objectId) ?? new Map<string, number>();
    counts.set(entry.property, (counts.get(entry.property) ?? 0) + 1);
    countsByObject.set(entry.objectId, counts);
  }
  return countsByObject;
}

function validateReceiptTuple(
  receipt: ObjectCommandReceiptShape,
  properties: readonly string[],
  message: string,
  context: z.RefinementCtx,
): void {
  for (const counts of propertyCountsByObject(receipt, properties).values()) {
    if (
      receipt.action !== 'replace_property' ||
      properties.some((property) => counts.get(property) !== 1)
    ) {
      context.addIssue({ code: 'custom', path: ['entries'], message });
    }
  }
}

function validateReceiptTuples(receipt: ObjectCommandReceiptShape, context: z.RefinementCtx): void {
  const statusProperties =
    receipt.objectKind === 'task'
      ? ['state', 'statusId', 'completedAt', 'canceledAt']
      : ['status', 'statusId'];
  validateReceiptTuple(
    receipt,
    statusProperties,
    `${receipt.objectKind === 'task' ? 'Task' : 'Project'} status receipt tuples must be complete and unique.`,
    context,
  );
  if (receipt.objectKind !== 'project') return;
  validateReceiptTuple(
    receipt,
    ['startDate', 'startDateResolution', 'startDateFiscalYearStartMonth'],
    'Project timeframe receipt tuples must be complete and unique.',
    context,
  );
  validateReceiptTuple(
    receipt,
    ['targetDate', 'targetDateResolution', 'targetDateFiscalYearStartMonth'],
    'Project timeframe receipt tuples must be complete and unique.',
    context,
  );
}

function receiptPropertySchemas(
  objectKind: ObjectCommandReceiptShape['objectKind'],
): Record<string, z.ZodType> {
  if (objectKind === 'task') {
    return {
      title: z.string().min(1),
      state: z.string().min(1).max(200),
      statusId: WorkStatusId,
      completedAt: z.iso.datetime().nullable(),
      canceledAt: z.iso.datetime().nullable(),
      priority: Priority,
      assigneeId: ActorId.nullable(),
      projectId: ProjectId.nullable(),
      programId: ProgramId.nullable(),
      milestoneId: MilestoneId.nullable(),
      cycleId: CycleId.nullable(),
      startDate: taskDate.nullable(),
      dueDate: taskDate.nullable(),
      estimate: z.number().int().min(0).nullable(),
      parentTaskId: TaskId.nullable(),
      archivedAt: z.iso.datetime().nullable(),
    };
  }
  return {
    status: z.string().min(1).max(200),
    statusId: WorkStatusId,
    priority: Priority,
    health: Health.nullable(),
    leadId: ActorId.nullable(),
    teamId: TeamId.nullable(),
    programId: ProgramId.nullable(),
    startDate: planningReceiptDate.nullable(),
    startDateResolution: DateResolution.nullable(),
    startDateFiscalYearStartMonth: z.number().int().min(0).max(11).nullable(),
    targetDate: planningReceiptDate.nullable(),
    targetDateResolution: DateResolution.nullable(),
    targetDateFiscalYearStartMonth: z.number().int().min(0).max(11).nullable(),
    archivedAt: z.iso.datetime().nullable(),
  };
}

function validateReceiptPropertyEntry(
  entry: ObjectCommandReceiptShape['entries'][number],
  index: number,
  properties: Readonly<Record<string, z.ZodType>>,
  context: z.RefinementCtx,
): void {
  if (entry.kind !== 'object') return;
  const schema = properties[entry.property];
  if (!schema) {
    context.addIssue({
      code: 'custom',
      path: ['entries', index, 'property'],
      message: 'Receipt property is not valid for this object kind.',
    });
    return;
  }
  for (const side of ['before', 'after'] as const) {
    if (schema.safeParse(entry[side]).success) continue;
    context.addIssue({
      code: 'custom',
      path: ['entries', index, side],
      message: 'Receipt property value is invalid.',
    });
  }
}

function validateReceiptProperties(
  receipt: ObjectCommandReceiptShape,
  context: z.RefinementCtx,
): void {
  const properties = receiptPropertySchemas(receipt.objectKind);
  receipt.entries.forEach((entry, index) => {
    validateReceiptPropertyEntry(entry, index, properties, context);
  });
}

function validateObjectCommandReceipt(
  receipt: ObjectCommandReceiptShape,
  context: z.RefinementCtx,
): void {
  validateReceiptCardinality(receipt, context);
  validateReceiptTuples(receipt, context);
  validateReceiptProperties(receipt, context);
}

/** A replay-safe receipt returned after a forward command or successful replay subset. */
export const ObjectCommandReceipt = ObjectCommandReceiptShape.superRefine(
  validateObjectCommandReceipt,
);
/** A replay-safe normalized command receipt. */
export type ObjectCommandReceipt = z.infer<typeof ObjectCommandReceipt>;

/** A replay request. `commandId` is the idempotency key for this replay attempt. */
export const ObjectCommandReplayIn = z.object({
  commandId,
  direction: z.enum(['undo', 'redo']),
  receipt: ObjectCommandReceipt,
});
/** A request to undo or redo a normalized receipt. */
export type ObjectCommandReplayIn = z.infer<typeof ObjectCommandReplayIn>;

/** A read-only request to check whether the current actor may replay one receipt. */
export const ObjectCommandReplayAccessIn = z.object({
  direction: z.enum(['undo', 'redo']),
  receipt: ObjectCommandReceipt,
});
/** A direction and receipt whose current replay access should be checked without applying it. */
export type ObjectCommandReplayAccessIn = z.infer<typeof ObjectCommandReplayAccessIn>;

/** Current replay access for every object and dependency endpoint in one receipt. */
export const ObjectCommandReplayAccessResult = z.object({
  allowed: z.boolean(),
  deniedIds: z.array(z.string()),
});
/** Whether replay is allowed plus every target whose required capability is missing. */
export type ObjectCommandReplayAccessResult = z.infer<typeof ObjectCommandReplayAccessResult>;

/** Result of a forward command or conflict-safe replay. */
export const ObjectCommandResult = z.object({
  appliedIds: z.array(z.string()),
  conflictingIds: z.array(z.string()),
  deniedIds: z.array(z.string()),
  receipt: ObjectCommandReceipt,
});
/** Applied, conflicted, and denied ids plus the replayable successful receipt. */
export type ObjectCommandResult = z.infer<typeof ObjectCommandResult>;

/** The request body accepted by the shared command endpoint. */
export const ObjectCommandRequest = z.union([ObjectCommandIn, ObjectCommandReplayIn]);
/** A forward or replay object-command request body. */
export type ObjectCommandRequest = z.infer<typeof ObjectCommandRequest>;
