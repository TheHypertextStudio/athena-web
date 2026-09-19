/**
 * `domain packages` — Plan draft DTOs.
 *
 * @remarks
 * A plan draft is a personal, durable document that Athena and its owner edit together on the
 * planning canvas: one initiative at the root, project containers under it, task rows inside
 * those containers, engineering subtasks one level under a feature task, and dependency edges
 * between nodes of the same kind. Nothing in the document
 * exists in the workspace until a node is confirmed, and confirming writes the real id back onto
 * the node so draft and created work coexist on one canvas.
 *
 * Unlike a template, a plan is one-shot, so its fields may name actors, teams, labels, and dates.
 * The reducer in `../plan-draft.ts` enforces which fields each kind accepts and every structural
 * rule; the contract only describes the shapes.
 */
import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { z } from 'zod';

import { InitiativeId, LabelId, TemplateId } from '../ids';
import { Priority } from '../task-contract';
import { Health } from './capability';
import { InitiativeUpdateCadence } from './initiative';

/** The kinds a plan may place. `program` is reserved for a later slice and accepted by the reducer. */
export const PlanNodeKind = z
  .enum(['initiative', 'program', 'project', 'task'])
  .describe('What the node becomes when confirmed.');
/** Plan node kind value. */
export type PlanNodeKind = z.infer<typeof PlanNodeKind>;

/** Whether a node is still a draft or has been created for real. */
export const PlanNodeStatus = z
  .enum(['draft', 'confirmed'])
  .describe('`draft` until confirmed; `confirmed` once a real object exists for it.');
/** Plan node status value. */
export type PlanNodeStatus = z.infer<typeof PlanNodeStatus>;

/**
 * One flat field bag shared by every kind.
 *
 * @remarks
 * The reducer rejects a field the node's kind does not carry, so a task never holds a target
 * timeframe and an initiative never holds a due date. Keeping one shape rather than four keeps the
 * op union small and lets the inspector render any node through one editor.
 */
export const PlanNodeFields = z
  .object({
    title: z.string().min(1).max(500).describe('The name or title. Required.'),
    summary: z.string().max(280).optional().describe('A one-line outcome summary.'),
    description: z.string().optional().describe('The markdown body.'),
    status: z.string().min(1).optional().describe('A workflow or lifecycle status key.'),
    priority: Priority.optional().describe('Task or project priority.'),
    health: Health.optional().describe('A health verdict for a project or initiative.'),
    updateCadence: InitiativeUpdateCadence.optional().describe('An initiative’s update interval.'),
    ownerId: ActorId.nullable().optional().describe('The accountable owner of an initiative.'),
    leadId: ActorId.nullable().optional().describe('The lead of a project.'),
    assigneeId: ActorId.nullable().optional().describe('Who a task is assigned to.'),
    teamId: TeamId.nullable().optional().describe('The owning team of a project or task.'),
    labelIds: z.array(LabelId).optional().describe('Labels to attach on create.'),
    targetDate: z.iso.date().nullable().optional().describe('Target finish, `YYYY-MM-DD`.'),
    startDate: z.iso.date().nullable().optional().describe('Anticipated start, `YYYY-MM-DD`.'),
    dueDate: z.iso.date().nullable().optional().describe('A task’s due day, `YYYY-MM-DD`.'),
    estimate: z.number().int().min(0).nullable().optional().describe('A task’s estimate.'),
  })
  .meta({ id: 'PlanNodeFields', description: 'The editable fields of one plan node.' });
/** Plan node fields value. */
export type PlanNodeFields = z.infer<typeof PlanNodeFields>;

/** One node of a plan document. */
export const PlanNode = z
  .object({
    ref: z.string().min(1).max(64).describe('A handle unique within the document.'),
    kind: PlanNodeKind,
    parentRef: z
      .string()
      .nullable()
      .describe(
        'The containing node. Null for an initiative; a task’s parent is its project, or a ' +
          'feature task when this task is an engineering subtask of it. Subtasks go one level ' +
          'deep: a task under a task carries no tasks of its own.',
      ),
    initiativeRefs: z
      .array(z.string())
      .describe('Additional initiative nodes in this document a project also belongs to.'),
    initiativeIds: z
      .array(InitiativeId)
      .describe('Existing initiatives, by real id, a project also belongs to.'),
    fields: PlanNodeFields,
    templateId: TemplateId.nullable().describe('The template applied to this node, when any.'),
    status: PlanNodeStatus,
    objectId: z.string().nullable().describe('The real id once confirmed.'),
  })
  .meta({ id: 'PlanNode', description: 'One node of a plan document.' });
/** Plan node value. */
export type PlanNode = z.infer<typeof PlanNode>;

/** A dependency between two nodes of the same kind. */
export const PlanEdge = z
  .object({
    fromRef: z.string().describe('The blocking node.'),
    toRef: z.string().describe('The blocked node.'),
    kind: z.literal('blocks'),
  })
  .meta({ id: 'PlanEdge', description: 'A dependency between two plan nodes.' });
/** Plan edge value. */
export type PlanEdge = z.infer<typeof PlanEdge>;

/** The whole document. Nodes are kept parents-first. */
export const PlanDocument = z
  .object({ nodes: z.array(PlanNode), edges: z.array(PlanEdge) })
  .meta({ id: 'PlanDocument', description: 'A plan draft’s nodes and edges.' });
/** Plan document value. */
export type PlanDocument = z.infer<typeof PlanDocument>;

/**
 * The fields an edit may carry: every field optional, so one schema serves both a new node and a
 * change to one. A new node must still arrive with a title; the reducer enforces that.
 */
export const PlanNodeFieldsPatch = PlanNodeFields.partial().meta({
  id: 'PlanNodeFieldsPatch',
  description: 'Fields to set on a plan node; omitted fields keep their values.',
});
/** Plan node fields patch value. */
export type PlanNodeFieldsPatch = z.infer<typeof PlanNodeFieldsPatch>;

/** The node shape an `upsert_node` op carries; omitted keys keep their current values. */
export const PlanUpsertNode = z.object({
  ref: z.string().min(1).max(64),
  kind: PlanNodeKind,
  parentRef: z.string().nullable().optional(),
  initiativeRefs: z.array(z.string()).optional(),
  initiativeIds: z.array(InitiativeId).optional(),
  fields: PlanNodeFieldsPatch,
  templateId: TemplateId.nullable().optional(),
});
/** Upsert payload value. */
export type PlanUpsertNode = z.infer<typeof PlanUpsertNode>;

/** The closed set of edits a plan document accepts. */
export const PlanOp = z
  .discriminatedUnion('op', [
    z.object({
      op: z.literal('set_title'),
      title: z.string().min(1).max(200).describe('Rename the plan itself.'),
    }),
    z.object({ op: z.literal('upsert_node'), node: PlanUpsertNode }),
    z.object({ op: z.literal('set_fields'), ref: z.string(), fields: PlanNodeFieldsPatch }),
    z.object({ op: z.literal('move_node'), ref: z.string(), parentRef: z.string().nullable() }),
    z.object({ op: z.literal('remove_node'), ref: z.string() }),
    z.object({ op: z.literal('add_edge'), fromRef: z.string(), toRef: z.string() }),
    z.object({ op: z.literal('remove_edge'), fromRef: z.string(), toRef: z.string() }),
    z.object({ op: z.literal('apply_template'), ref: z.string(), templateId: TemplateId }),
  ])
  .meta({ id: 'PlanOp', description: 'One edit to a plan document.' });
/** Plan op value. */
export type PlanOp = z.infer<typeof PlanOp>;

/** A plan’s lifecycle. `committed` means every node has been confirmed. */
export const PlanDraftStatus = z.enum(['active', 'committed', 'archived']);
/** Plan draft status value. */
export type PlanDraftStatus = z.infer<typeof PlanDraftStatus>;

/** What the read hydrates for a confirmed node from its real record. */
export const PlanObjectSnapshot = z
  .object({
    name: z.string(),
    statusName: z.string().nullable(),
    health: Health.nullable(),
    href: z.string(),
    archived: z.boolean(),
  })
  .meta({ id: 'PlanObjectSnapshot', description: 'A confirmed node’s live record.' });
/** Plan object snapshot value. */
export type PlanObjectSnapshot = z.infer<typeof PlanObjectSnapshot>;

/** A plan draft as the API returns it. */
export const PlanDraftOut = z
  .object({
    id: z.string(),
    organizationId: OrganizationId,
    sessionId: z.string().nullable(),
    rootInitiativeId: InitiativeId.nullable(),
    title: z.string(),
    status: PlanDraftStatus,
    revision: z.number().int(),
    document: PlanDocument,
    objects: z
      .record(z.string(), PlanObjectSnapshot)
      .describe('Live records for confirmed nodes, keyed by ref.'),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'PlanDraftOut', description: 'A personal planning draft and its document.' });
/** Plan draft value. */
export type PlanDraftOut = z.infer<typeof PlanDraftOut>;

/** A page of plans. */
export const PlanDraftListOut = z
  .object({ items: z.array(PlanDraftOut) })
  .meta({ id: 'PlanDraftListOut', description: 'The caller’s plans.' });
/** Plan list value. */
export type PlanDraftListOut = z.infer<typeof PlanDraftListOut>;

/** Start a plan, or reopen the active one rooted on the same initiative. */
export const PlanDraftCreate = z
  .object({
    organizationId: OrganizationId.describe('The workspace the plan writes into.'),
    initiativeId: InitiativeId.optional().describe('An existing initiative to plan under.'),
    title: z.string().min(1).max(200).optional().describe('The plan title.'),
  })
  .meta({ id: 'PlanDraftCreate', description: 'Start or reopen a planning draft.' });
/** Plan create value. */
export type PlanDraftCreate = z.infer<typeof PlanDraftCreate>;

/** A batch of ops against one revision. */
export const PlanDraftPatch = z
  .object({
    revision: z.number().int().min(0).describe('The revision the ops were written against.'),
    ops: z.array(PlanOp).min(1).max(200),
  })
  .meta({ id: 'PlanDraftPatch', description: 'A batch of draft operations against one revision.' });
/** Plan patch value. */
export type PlanDraftPatch = z.infer<typeof PlanDraftPatch>;

/** The nodes to create for real. Unconfirmed ancestors are included automatically. */
export const PlanCommitBody = z
  .object({ refs: z.array(z.string()).min(1).max(200) })
  .meta({ id: 'PlanCommitBody', description: 'The draft nodes to create for real.' });
/** Plan commit body value. */
export type PlanCommitBody = z.infer<typeof PlanCommitBody>;

/** What one confirmed node became. */
export const PlanPlaced = z.object({
  ref: z.string(),
  kind: PlanNodeKind,
  id: z.string(),
  created: z.boolean().describe('False when an existing object of that name was matched.'),
});
/** Plan placed value. */
export type PlanPlaced = z.infer<typeof PlanPlaced>;

/**
 * How many records of each kind a commit created.
 *
 * @remarks
 * A subtask is counted apart from a task because the confirmation line reads them apart — "24
 * tasks" means something different when half of them hang off the other half. Matched records are
 * excluded: the line reports what the commit put into the workspace, and `placed` carries the rest.
 */
export const PlanCommitCounts = z
  .object({
    initiatives: z.number().int().describe('Initiatives created.'),
    projects: z.number().int().describe('Projects created.'),
    tasks: z.number().int().describe('Tasks created that sit directly in a project.'),
    subtasks: z.number().int().describe('Tasks created under another task.'),
  })
  .meta({ id: 'PlanCommitCounts', description: 'What one commit created, by kind.' });
/** Plan commit counts value. */
export type PlanCommitCounts = z.infer<typeof PlanCommitCounts>;

/** The result of confirming part of a plan. */
export const PlanCommitOut = z
  .object({
    plan: PlanDraftOut,
    placed: z.array(PlanPlaced),
    createdCounts: PlanCommitCounts,
    changeSetId: z.string().nullable(),
  })
  .meta({ id: 'PlanCommitOut', description: 'The result of confirming part of a plan.' });
/** Plan commit result value. */
export type PlanCommitOut = z.infer<typeof PlanCommitOut>;

/** One person a plan may assign work to. */
export const PlanRosterPerson = z
  .object({
    actorId: ActorId.describe('Set this as `assigneeId`, `leadId`, or `ownerId` on a node.'),
    name: z.string().describe('How the person is named in this workspace.'),
    teamIds: z.array(TeamId).describe('The teams they are on, for picking who does what.'),
  })
  .meta({ id: 'PlanRosterPerson', description: 'A person a plan node may name.' });
/** Plan roster person value. */
export type PlanRosterPerson = z.infer<typeof PlanRosterPerson>;

/** One team a plan may assign work to. */
export const PlanRosterTeam = z
  .object({
    id: TeamId.describe('Set this as `teamId` on a project or task node.'),
    name: z.string().describe('What the team is called.'),
  })
  .meta({ id: 'PlanRosterTeam', description: 'A team a plan node may name.' });
/** Plan roster team value. */
export type PlanRosterTeam = z.infer<typeof PlanRosterTeam>;

/** Who a plan may assign its work to. */
export const PlanRoster = z
  .object({ people: z.array(PlanRosterPerson), teams: z.array(PlanRosterTeam) })
  .meta({ id: 'PlanRoster', description: 'The people and teams a plan may assign work to.' });
/** Plan roster value. */
export type PlanRoster = z.infer<typeof PlanRoster>;

/** A template a node may apply. */
export const PlanTemplateOption = z
  .object({
    id: TemplateId,
    targetType: PlanNodeKind,
    name: z.string(),
    description: z.string().nullable(),
  })
  .meta({ id: 'PlanTemplateOption', description: 'A template available to a plan node.' });
/** Plan template option value. */
export type PlanTemplateOption = z.infer<typeof PlanTemplateOption>;

/** The catalog names of Athena’s plan tools, shared by the loop, the toolbox, and the web thread. */
export const PLAN_TOOL_NAMES = {
  start: 'plan_start',
  read: 'plan_read',
  draft: 'plan_draft',
  commit: 'plan_commit',
} as const;
