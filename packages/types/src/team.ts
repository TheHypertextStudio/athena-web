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
export const WorkflowStateType = z
  .enum(['backlog', 'unstarted', 'started', 'completed', 'canceled'])
  .describe(
    "The canonical category a team's workflow state maps onto, driving status icons and board grouping: 'backlog' (not yet committed) | 'unstarted' (committed, not begun) | 'started' (in progress) | 'completed' (done) | 'canceled' (abandoned). Multiple per-team states can share a type (e.g. several 'started' columns).",
  );
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
    key: z
      .string()
      .min(1)
      .describe(
        "Stable per-team identifier for this state, stored on `task.state`. There is no global FK — keys are scoped to the team's `workflow_states` array — so keys need only be unique within one team's workflow.",
      ),
    name: z
      .string()
      .min(1)
      .describe('Human-readable label shown on the board column / status picker.'),
    type: WorkflowStateType.describe(
      'The canonical category this state maps onto (backlog/unstarted/started/completed/canceled), used for icons and grouping.',
    ),
    position: z
      .number()
      .int()
      .describe(
        "Integer sort order of this state within the team's workflow (ascending, left-to-right on the board).",
      ),
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
    name: z.string().min(1).describe("The team's display name (e.g. 'Engineering')."),
    key: z
      .string()
      .min(1)
      .describe(
        "Short key for the team (e.g. 'ENG'), unique within the org (the `(organization_id, key)` constraint). A duplicate key is rejected with 409. Often used as a prefix for the team's task identifiers.",
      ),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Optional free-text description of the team. Pass null to leave unset.'),
    summary: z
      .string()
      .max(280)
      .optional()
      .describe('Optional plain-text summary, limited to 280 characters.'),
    workflowStates: z
      .array(WorkflowState)
      .min(1)
      .optional()
      .describe(
        'The ordered list of workflow states for the team (at least one). When omitted, the team is seeded with the canonical five-state default: Backlog › Todo › In Progress › Done › Canceled.',
      ),
    triageEnabled: z
      .boolean()
      .optional()
      .describe(
        "Whether the team's Triage queue is enabled (where unsorted incoming tasks land before being assigned to a workflow state). Defaults to true.",
      ),
    agentGuidance: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Optional free-text guidance shown to AI agents operating within this team — house rules / context that shapes agent behavior on the team's work. Pass null to leave unset.",
      ),
    approvalRouting: ApprovalRouting.nullable()
      .optional()
      .describe(
        "Optional policy controlling how an agent's proposed actions are routed for human approval within this team. Null means no team-level routing override. See the agent slice's ApprovalRouting for the policy shape.",
      ),
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
    name: z
      .string()
      .min(1)
      .optional()
      .describe('New display name. Optional; omit to leave unchanged.'),
    key: z
      .string()
      .min(1)
      .optional()
      .describe(
        'New team key. Optional; omit to leave unchanged. Still subject to org-wide uniqueness — a collision with another team is rejected with 409 (the team being patched is excluded from the check).',
      ),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('New description, or null to clear it. Optional; omit to leave unchanged.'),
    summary: z
      .string()
      .max(280)
      .optional()
      .describe('New plain-text summary. Omit to leave unchanged; send an empty string to clear.'),
    workflowStates: z
      .array(WorkflowState)
      .min(1)
      .optional()
      .describe(
        'Replace the entire workflow-state list (at least one state). This is a full replacement, not a merge — omitted states are removed. Optional; omit to leave unchanged.',
      ),
    triageEnabled: z
      .boolean()
      .optional()
      .describe("Toggle the team's Triage queue. Optional; omit to leave unchanged."),
    agentGuidance: z
      .string()
      .nullable()
      .optional()
      .describe('New agent guidance text, or null to clear it. Optional; omit to leave unchanged.'),
    approvalRouting: ApprovalRouting.nullable()
      .optional()
      .describe(
        'New approval-routing policy, or null to clear it. Optional; omit to leave unchanged.',
      ),
  })
  .meta({ id: 'TeamUpdate', description: 'Update a team.' });
/** Validated team-update body. */
export type TeamUpdate = z.infer<typeof TeamUpdate>;

/** Team representation returned by reads. */
export const TeamOut = z
  .object({
    id: TeamId.describe('Stable ULID identifier of the team.'),
    organizationId: OrganizationId.describe('The organization this team belongs to.'),
    name: z.string().describe("The team's display name."),
    key: z.string().describe("The team's short key, unique within the org."),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Free-text description of the team; null when unset.'),
    summary: z.string().nullable().describe('Plain-text summary, or `null` when none.'),
    workflowStates: z
      .array(WorkflowState)
      .optional()
      .describe(
        "The team's ordered workflow states. Optional in this list shape; always present (required) in TeamDetail.",
      ),
    triageEnabled: z.boolean().describe("Whether the team's Triage queue is enabled."),
    agentGuidance: z
      .string()
      .nullable()
      .optional()
      .describe('Free-text guidance for AI agents operating in this team; null when unset.'),
    approvalRouting: ApprovalRouting.nullable()
      .optional()
      .describe("The team's agent-approval-routing policy; null when no override is set."),
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
  workflowStates: z
    .array(WorkflowState)
    .describe(
      "The team's complete ordered workflow-state list (always materialized on a detail read).",
    ),
}).meta({ id: 'TeamDetail', description: 'Full detail for a single team.' });
/** Team-detail value. */
export type TeamDetail = z.infer<typeof TeamDetail>;

/** Result of soft-deleting (archiving) a Team. */
export const TeamDeleteResult = z
  .object({
    id: TeamId.describe('The id of the team that was archived.'),
    archivedAt: z
      .string()
      .describe(
        'ISO-8601 timestamp the team was soft-deleted (archived). The row is retained — archived teams are excluded from list/get reads but not erased.',
      ),
  })
  .meta({ id: 'TeamDeleteResult', description: 'The archived team id + timestamp.' });
/** Team-delete-result value. */
export type TeamDeleteResult = z.infer<typeof TeamDeleteResult>;
