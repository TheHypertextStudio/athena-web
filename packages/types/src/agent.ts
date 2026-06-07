/**
 * `@docket/types` — Agent & Agent Session slice DTOs.
 *
 * @remarks
 * An Agent is the persistent org-registered wrapper around an ephemeral external
 * runtime; it IS an {@link ActorId}-backed Actor (`actor.kind = 'agent'`) carrying a
 * connection, an approval policy, and an accountable human owner. Registering an
 * agent materializes its Actor when one isn't supplied. An Agent Session is the
 * Docket-hosted lifecycle of one agent task plus its visible Activity stream;
 * compute/cost/telemetry are NOT modeled (the provider owns execution).
 */
import { z } from 'zod';

import {
  ActorId,
  AgentId,
  AgentSessionId,
  OrganizationId,
  SessionActivityId,
  TaskId,
} from './primitives';

/** Per-agent approval policy: suggest only, act-with-approval, or fully autonomous. */
export const ApprovalPolicy = z.enum(['suggest', 'act_with_approval', 'autonomous']);
/** Approval-policy value. */
export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>;

/** The wire protocol Docket uses to reach an agent's external runtime. */
export const AgentProtocol = z.enum(['mcp', 'a2a', 'webhook']);
/** Agent-protocol value. */
export type AgentProtocol = z.infer<typeof AgentProtocol>;

/** How Docket reaches an agent's external runtime (never stores the secret itself). */
export const AgentConnection = z
  .object({
    endpoint: z.string(),
    protocol: AgentProtocol,
    credentialsRef: z.string().optional(),
  })
  .meta({ id: 'AgentConnection', description: "An agent runtime's connection metadata." });
/** Agent-connection value. */
export type AgentConnection = z.infer<typeof AgentConnection>;

/** Who approves an agent's gated actions: the assigner, a fixed actor, or a role. */
export const ApprovalRouting = z
  .object({
    mode: z.enum(['assigner', 'fixed', 'role']),
    approverActorId: z.string().optional(),
    approverRoleId: z.string().optional(),
  })
  .meta({ id: 'ApprovalRouting', description: "An agent's approval-routing config." });
/** Approval-routing value. */
export type ApprovalRouting = z.infer<typeof ApprovalRouting>;

/**
 * Body for registering an Agent (organizationId comes from the path, never the body).
 *
 * @remarks
 * Supply `actorId` to wrap an existing `agent`-kind Actor, or `displayName` to have
 * Docket materialize a new agent Actor for this registration.
 */
export const AgentCreate = z
  .object({
    actorId: ActorId.optional(),
    displayName: z.string().min(1).optional(),
    connection: AgentConnection.nullable().optional(),
    approvalPolicy: ApprovalPolicy.optional(),
    accountableOwnerId: ActorId.nullable().optional(),
    guidance: z.string().nullable().optional(),
    approvalRouting: ApprovalRouting.nullable().optional(),
  })
  .meta({ id: 'AgentCreate', description: 'Register an agent within an organization.' });
/** Validated agent-create body. */
export type AgentCreate = z.infer<typeof AgentCreate>;

/** Body for updating an Agent's connection, policy, owner, guidance, or routing. */
export const AgentUpdate = z
  .object({
    connection: AgentConnection.nullable().optional(),
    approvalPolicy: ApprovalPolicy.optional(),
    accountableOwnerId: ActorId.nullable().optional(),
    guidance: z.string().nullable().optional(),
    approvalRouting: ApprovalRouting.nullable().optional(),
  })
  .meta({ id: 'AgentUpdate', description: 'Update a registered agent.' });
/** Validated agent-update body. */
export type AgentUpdate = z.infer<typeof AgentUpdate>;

/** Full agent representation returned by reads. */
export const AgentOut = z
  .object({
    id: AgentId,
    organizationId: OrganizationId,
    actorId: ActorId,
    connection: AgentConnection.nullable().optional(),
    approvalPolicy: ApprovalPolicy,
    accountableOwnerId: ActorId.nullable().optional(),
    guidance: z.string().nullable().optional(),
    approvalRouting: ApprovalRouting.nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'AgentOut', description: 'A registered agent.' });
/** Agent representation value. */
export type AgentOut = z.infer<typeof AgentOut>;

/** Agent Session lifecycle status. */
export const SessionStatus = z.enum([
  'pending',
  'running',
  'awaiting_input',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
]);
/** Session-status value. */
export type SessionStatus = z.infer<typeof SessionStatus>;

/** What triggered an Agent Session. */
export const SessionTrigger = z.enum(['assignment', 'delegation', 'mention']);
/** Session-trigger value. */
export type SessionTrigger = z.infer<typeof SessionTrigger>;

/** The visible Activity-stream entry types an agent emits. */
export const SessionActivityType = z.enum([
  'thought',
  'action',
  'response',
  'elicitation',
  'error',
]);
/** Session-activity-type value. */
export type SessionActivityType = z.infer<typeof SessionActivityType>;

/** Approval state of a gated agent action. */
export const ApprovalStatus = z.enum(['proposed', 'approved', 'rejected', 'applied']);
/** Approval-status value. */
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** One entry in a session's visible Activity stream; `action` rows carry an approval. */
export const SessionActivityOut = z
  .object({
    id: SessionActivityId,
    sessionId: AgentSessionId,
    organizationId: OrganizationId,
    type: SessionActivityType,
    body: z.record(z.string(), z.unknown()),
    approvalStatus: ApprovalStatus.nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'SessionActivityOut', description: "An entry in a session's Activity stream." });
/** Session-activity representation value. */
export type SessionActivityOut = z.infer<typeof SessionActivityOut>;

/** An Agent Session summary returned by list reads. */
export const AgentSessionOut = z
  .object({
    id: AgentSessionId,
    organizationId: OrganizationId,
    agentId: AgentId,
    taskId: TaskId.nullable().optional(),
    trigger: SessionTrigger,
    status: SessionStatus,
    initiatorId: ActorId.nullable().optional(),
    externalRunRef: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    endedAt: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'AgentSessionOut', description: 'A Docket-hosted agent session.' });
/** Agent-session representation value. */
export type AgentSessionOut = z.infer<typeof AgentSessionOut>;

/** An Agent Session with its full ordered Activity stream (single-session read). */
export const AgentSessionDetailOut = AgentSessionOut.extend({
  activities: z.array(SessionActivityOut),
}).meta({ id: 'AgentSessionDetailOut', description: 'An agent session with its activity stream.' });
/** Agent-session-detail representation value. */
export type AgentSessionDetailOut = z.infer<typeof AgentSessionDetailOut>;

/**
 * Body for deciding on a proposed agent action (the approval gate, permissions §9).
 *
 * @remarks
 * `decision` records the approver's choice; on `approve` the gated `action` activity
 * advances `proposed → approved → applied` and an `audit_event` is written. `scope`
 * controls whether the decision applies to this single action (`this`, default) or to
 * every still-proposed action in the session (`all_in_session`).
 */
export const SessionApprovalDecision = z
  .object({
    decision: z.enum(['approve', 'reject']),
    scope: z.enum(['this', 'all_in_session']).optional(),
  })
  .meta({
    id: 'SessionApprovalDecision',
    description: 'An approver decision on a proposed agent action.',
  });
/** Validated approval-decision body. */
export type SessionApprovalDecision = z.infer<typeof SessionApprovalDecision>;

/**
 * Body for replying to an agent's `elicitation` activity (steers / answers the agent).
 *
 * @remarks
 * Appends a human `response` activity to the session stream and, when the session was
 * `awaiting_input`, resumes it to `running` so the agent can proceed (contract §3.11
 * `POST /:sessionId/messages`).
 */
export const SessionReplyBody = z
  .object({
    body: z.string().min(1),
  })
  .meta({ id: 'SessionReplyBody', description: 'A human reply to a session elicitation.' });
/** Validated session-reply body. */
export type SessionReplyBody = z.infer<typeof SessionReplyBody>;
