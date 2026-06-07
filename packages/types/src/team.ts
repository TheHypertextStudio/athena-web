/**
 * `@docket/types` — Team slice DTOs.
 *
 * @remarks
 * A Team is a first-class unit within an organization that owns its own
 * `workflow_states`, Cycles, and the Triage queue. Its `key` is unique within the
 * org. New teams default to the canonical five-state workflow ({@link DEFAULT_WORKFLOW_STATES})
 * with Triage enabled. `organizationId` is always derived from the request path,
 * never the body, so the create/update bodies never carry it.
 */
import { z } from 'zod';

import { ApprovalRouting } from './agent';
import { OrganizationId, TeamId } from './primitives';

/** The five canonical workflow-state types a per-team state key maps onto. */
export const WorkflowStateType = z.enum([
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
]);
/** Workflow-state-type value. */
export type WorkflowStateType = z.infer<typeof WorkflowStateType>;

/**
 * One configurable workflow state in a team's `workflow_states` array.
 *
 * @remarks
 * `key` is the stable identifier stored on `task.state` (per-team, no global FK);
 * `type` drives status icons + grouping; `position` orders the team's state list.
 */
export const WorkflowState = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    type: WorkflowStateType,
    position: z.number().int(),
  })
  .meta({ id: 'WorkflowState', description: "One state in a team's workflow." });
/** Workflow-state value. */
export type WorkflowState = z.infer<typeof WorkflowState>;

/**
 * The default per-team workflow seeded on new teams.
 *
 * @remarks
 * Mirrors `@docket/db`'s `defaultWorkflowStates`; the first state's key (`backlog`)
 * is the new-task default. Used to populate `workflowStates` when a create body
 * omits it.
 *
 * @example
 * ```typescript
 * const states = body.workflowStates ?? DEFAULT_WORKFLOW_STATES;
 * ```
 */
export const DEFAULT_WORKFLOW_STATES: readonly WorkflowState[] = [
  { key: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
  { key: 'todo', name: 'Todo', type: 'unstarted', position: 1 },
  { key: 'in_progress', name: 'In Progress', type: 'started', position: 2 },
  { key: 'done', name: 'Done', type: 'completed', position: 3 },
  { key: 'canceled', name: 'Canceled', type: 'canceled', position: 4 },
];

/**
 * Body for creating a Team (organizationId comes from the path, never the body).
 *
 * @remarks
 * `workflowStates` defaults to {@link DEFAULT_WORKFLOW_STATES} and `triageEnabled`
 * defaults to `true` when omitted. `key` must be unique within the org.
 */
export const TeamCreate = z
  .object({
    name: z.string().min(1),
    key: z.string().min(1),
    description: z.string().nullable().optional(),
    workflowStates: z.array(WorkflowState).min(1).optional(),
    triageEnabled: z.boolean().optional(),
    agentGuidance: z.string().nullable().optional(),
    approvalRouting: ApprovalRouting.nullable().optional(),
  })
  .meta({ id: 'TeamCreate', description: 'Create a team within an organization.' });
/** Validated team-create body. */
export type TeamCreate = z.infer<typeof TeamCreate>;

/**
 * Body for updating a Team.
 *
 * @remarks
 * Every field is optional; only the supplied fields are changed. Updating `key`
 * still requires org-wide uniqueness. Setting `workflowStates` replaces the whole
 * array. `approvalRouting`/`agentGuidance`/`description` accept `null` to clear.
 */
export const TeamUpdate = z
  .object({
    name: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    workflowStates: z.array(WorkflowState).min(1).optional(),
    triageEnabled: z.boolean().optional(),
    agentGuidance: z.string().nullable().optional(),
    approvalRouting: ApprovalRouting.nullable().optional(),
  })
  .meta({ id: 'TeamUpdate', description: 'Update a team.' });
/** Validated team-update body. */
export type TeamUpdate = z.infer<typeof TeamUpdate>;

/** Team representation returned by reads. */
export const TeamOut = z
  .object({
    id: TeamId,
    organizationId: OrganizationId,
    name: z.string(),
    key: z.string(),
    description: z.string().nullable().optional(),
    workflowStates: z.array(WorkflowState).optional(),
    triageEnabled: z.boolean(),
    agentGuidance: z.string().nullable().optional(),
    approvalRouting: ApprovalRouting.nullable().optional(),
  })
  .meta({ id: 'TeamOut', description: 'A team within an organization.' });
/** Team representation value. */
export type TeamOut = z.infer<typeof TeamOut>;

/**
 * Full team detail returned by `GET /:teamId`.
 *
 * @remarks
 * Identical shape to {@link TeamOut} but with `workflowStates` required (a detail
 * read always materializes the team's full state list).
 */
export const TeamDetail = TeamOut.extend({
  workflowStates: z.array(WorkflowState),
}).meta({ id: 'TeamDetail', description: 'Full detail for a single team.' });
/** Team-detail value. */
export type TeamDetail = z.infer<typeof TeamDetail>;

/** Result of soft-deleting (archiving) a Team. */
export const TeamDeleteResult = z
  .object({ id: TeamId, archivedAt: z.string() })
  .meta({ id: 'TeamDeleteResult', description: 'The archived team id + timestamp.' });
/** Team-delete-result value. */
export type TeamDeleteResult = z.infer<typeof TeamDeleteResult>;
