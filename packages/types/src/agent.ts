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
export const ApprovalPolicy = z
  .enum(['suggest', 'act_with_approval', 'autonomous'])
  .describe(
    "How much autonomy a registered agent has over its proposed mutations: `suggest` — the agent may only propose, every action needs human approval to apply; `act_with_approval` — the agent acts, but actions flagged as gated park the session in `awaiting_approval` until approved/rejected; `autonomous` — the agent's actions apply without a human gate (still bounded by its capability checks).",
  );
/** Approval-policy value. */
export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>;

/** The wire protocol Docket uses to reach an agent's external runtime. */
export const AgentProtocol = z
  .enum(['mcp', 'a2a', 'webhook'])
  .describe(
    "The wire protocol Docket speaks to reach the agent's external runtime: `mcp` (Model Context Protocol), `a2a` (agent-to-agent), or `webhook` (HTTP callback).",
  );
/** Agent-protocol value. */
export type AgentProtocol = z.infer<typeof AgentProtocol>;

/** How Docket reaches an agent's external runtime (never stores the secret itself). */
export const AgentConnection = z
  .object({
    endpoint: z
      .string()
      .describe(
        "The agent runtime's address — the MCP/A2A server URL or the webhook endpoint Docket calls.",
      ),
    protocol: AgentProtocol.describe('Which wire protocol that endpoint speaks.'),
    credentialsRef: z
      .string()
      .optional()
      .describe(
        'An opaque reference to the stored credential used to authenticate to the endpoint; Docket never stores the raw secret, only this pointer.',
      ),
  })
  .meta({ id: 'AgentConnection', description: "An agent runtime's connection metadata." });
/** Agent-connection value. */
export type AgentConnection = z.infer<typeof AgentConnection>;

/** Who approves an agent's gated actions: the assigner, a fixed actor, or a role. */
export const ApprovalRouting = z
  .object({
    mode: z
      .enum(['assigner', 'fixed', 'role'])
      .describe(
        "How the approver for this agent's gated actions is chosen: `assigner` — whoever assigned/initiated the work approves; `fixed` — a specific actor (`approverActorId`) approves; `role` — any holder of a role (`approverRoleId`) may approve.",
      ),
    approverActorId: z
      .string()
      .optional()
      .describe("The fixed approver's actor id; used only when `mode` is `fixed`."),
    approverRoleId: z
      .string()
      .optional()
      .describe('The role whose holders may approve; used only when `mode` is `role`.'),
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
    actorId: ActorId.optional().describe(
      'Wrap an EXISTING `agent`-kind Actor by id. Mutually exclusive with `displayName`; supply exactly one.',
    ),
    displayName: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Materialize a NEW agent Actor with this display name. Supply instead of `actorId` when no Actor exists yet.',
      ),
    connection: AgentConnection.nullable()
      .optional()
      .describe(
        'How to reach the agent runtime (endpoint + protocol). Optional/null for an agent with no external runtime yet.',
      ),
    approvalPolicy: ApprovalPolicy.optional().describe(
      'Initial autonomy level; defaults to the server policy when omitted.',
    ),
    accountableOwnerId: ActorId.nullable()
      .optional()
      .describe(
        "The human Actor accountable for this agent's actions. Null/omitted leaves it unset.",
      ),
    guidance: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Freeform operating instructions/persona steering threaded to the agent at run time. Null/omitted for none.',
      ),
    approvalRouting: ApprovalRouting.nullable()
      .optional()
      .describe(
        "Who approves this agent's gated actions. Null/omitted falls back to the default routing.",
      ),
  })
  .meta({ id: 'AgentCreate', description: 'Register an agent within an organization.' });
/** Validated agent-create body. */
export type AgentCreate = z.infer<typeof AgentCreate>;

/** Body for updating an Agent's connection, policy, owner, guidance, or routing. */
export const AgentUpdate = z
  .object({
    connection: AgentConnection.nullable()
      .optional()
      .describe('Replace the runtime connection; omit to leave unchanged, `null` to clear it.'),
    approvalPolicy: ApprovalPolicy.optional().describe(
      "Change the agent's autonomy level; omit to leave unchanged. Affects future sessions, not already-settled activities.",
    ),
    accountableOwnerId: ActorId.nullable()
      .optional()
      .describe(
        'Reassign (or `null` to clear) the accountable human owner; omit to leave unchanged.',
      ),
    guidance: z
      .string()
      .nullable()
      .optional()
      .describe('Replace (or `null` to clear) the operating guidance; omit to leave unchanged.'),
    approvalRouting: ApprovalRouting.nullable()
      .optional()
      .describe(
        "Re-route who approves this agent's gated actions; omit to leave unchanged, `null` to reset to default.",
      ),
  })
  .meta({ id: 'AgentUpdate', description: 'Update a registered agent.' });
/** Validated agent-update body. */
export type AgentUpdate = z.infer<typeof AgentUpdate>;

/** Full agent representation returned by reads. */
export const AgentOut = z
  .object({
    id: AgentId.describe('The agent registration id (distinct from the backing Actor id).'),
    organizationId: OrganizationId.describe('The organization this agent is registered in.'),
    actorId: ActorId.describe(
      'The `agent`-kind Actor that backs this agent — the identity it acts and is audited as.',
    ),
    connection: AgentConnection.nullable()
      .optional()
      .describe(
        'The runtime connection metadata (endpoint + protocol, never the secret); null when no runtime is configured.',
      ),
    approvalPolicy: ApprovalPolicy.describe(
      "The agent's current autonomy level over its proposed mutations.",
    ),
    accountableOwnerId: ActorId.nullable()
      .optional()
      .describe('The human Actor accountable for this agent; null when unset.'),
    guidance: z
      .string()
      .nullable()
      .optional()
      .describe('Freeform operating guidance threaded to the agent at run time; null when none.'),
    approvalRouting: ApprovalRouting.nullable()
      .optional()
      .describe(
        "How approvers for this agent's gated actions are chosen; null when using the default routing.",
      ),
    createdAt: z.string().describe('ISO-8601 timestamp the agent was registered.'),
  })
  .meta({ id: 'AgentOut', description: 'A registered agent.' });
/** Agent representation value. */
export type AgentOut = z.infer<typeof AgentOut>;

/** One content block inside a {@link TurnMessage} (the durable conversation unit). */
export const TurnContentBlock = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: z.string().describe('Plain text content.'),
    }),
    z.object({
      type: z.literal('thinking'),
      thinking: z.string().describe('The (possibly summarized) provider reasoning text.'),
      signature: z
        .string()
        .describe('The provider integrity signature required to replay this block verbatim.'),
    }),
    z.object({
      type: z.literal('tool_use'),
      id: z.string().describe('The provider block id; pairs the call with its `tool_result`.'),
      name: z
        .string()
        .describe('The tool name (namespaced for remote connections, e.g. `sunsama__get_...`).'),
      input: z.unknown().describe('The parsed tool input.'),
    }),
    z.object({
      type: z.literal('tool_result'),
      toolUseId: z.string().describe('The `tool_use` block id this result answers.'),
      content: z.string().describe('The serialized result content.'),
      isError: z
        .boolean()
        .describe('Whether the tool call failed (the model reacts instead of assuming success).'),
    }),
  ])
  .describe('One content block of a durable agent-conversation message.');
/** Turn-content-block value. */
export type TurnContentBlock = z.infer<typeof TurnContentBlock>;

/**
 * One message in a session's durable provider transcript.
 *
 * @remarks
 * The canonical cross-package shape: the `@docket/agent-runtime` turn port speaks
 * it and `@docket/db` persists it (`agent_session_transcript.messages`), so the
 * conversation a session resumes from can never drift from what the runtime emitted.
 * `thinking` blocks keep their provider `signature`, which is what makes replaying a
 * persisted transcript lossless across approvals that take days and server restarts.
 */
export const TurnMessage = z
  .object({
    role: z.enum(['user', 'assistant']).describe('Who produced the message.'),
    content: z.array(TurnContentBlock).describe('The ordered content blocks.'),
  })
  .meta({ id: 'TurnMessage', description: 'One durable agent-conversation message.' });
/** Turn-message value. */
export type TurnMessage = z.infer<typeof TurnMessage>;

/**
 * The two framings of one session substrate: a persistent conversational `chat`
 * thread vs. an episodic delegated `job`.
 */
export const SessionKind = z
  .enum(['chat', 'job'])
  .describe(
    "How the session renders and lives: `chat` — the org's long-lived conversational Athena thread (one open per org+agent, conversational rendering); `job` — one episodic delegated piece of work (work-log rendering, terminal states). Same loop, transcript, toolbox, and approval gate underneath.",
  );
/** Session-kind value. */
export type SessionKind = z.infer<typeof SessionKind>;

/** Agent Session lifecycle status. */
export const SessionStatus = z
  .enum([
    'pending',
    'running',
    'awaiting_input',
    'awaiting_approval',
    'completed',
    'failed',
    'canceled',
  ])
  .describe(
    "The session's lifecycle state: `pending` (created, not yet dispatched — e.g. a proactively drafted plan); `running` (the agent is actively executing); `awaiting_input` (paused, waiting on a human reply to an elicitation); `awaiting_approval` (parked on a gated `proposed` action needing approve/reject); `completed` (finished, terminal); `failed` (errored, terminal); `canceled` (stopped by a human or a rejection, terminal).",
  );
/** Session-status value. */
export type SessionStatus = z.infer<typeof SessionStatus>;

/** What triggered an Agent Session. */
export const SessionTrigger = z
  .enum(['assignment', 'delegation', 'mention'])
  .describe(
    'Why the session started: `assignment` (work was assigned to the agent), `delegation` (a human explicitly delegated a task/prompt to the agent — the "ask Athena to plan" path), or `mention` (a proactive trigger from an inbound observation that mentioned the agent/user).',
  );
/** Session-trigger value. */
export type SessionTrigger = z.infer<typeof SessionTrigger>;

/** The visible Activity-stream entry types an agent emits. */
export const SessionActivityType = z
  .enum(['thought', 'action', 'response', 'elicitation', 'error'])
  .describe(
    "The kind of activity entry: `thought` (the agent's reasoning, no side effect); `action` (a proposed/applied mutation — the only kind that carries an `approvalStatus` and may be gated); `response` (a textual message — agent output OR a human reply/seed prompt); `elicitation` (the agent asking the human a question, answerable via the reply route); `error` (a failure the agent surfaced).",
  );
/** Session-activity-type value. */
export type SessionActivityType = z.infer<typeof SessionActivityType>;

/** Approval state of a gated agent action. */
export const ApprovalStatus = z
  .enum(['proposed', 'approved', 'rejected', 'applied'])
  .describe(
    "Where a gated `action` sits in the approval gate: `proposed` (awaiting a human decision — parks the session in `awaiting_approval`); `approved` (a human cleared it — transient before apply, used by the session-level shortcut); `rejected` (a human vetoed it — never applies); `applied` (approved AND its effect has been applied — the gate's terminal success state, set by the activity-scoped approve route).",
  );
/** Approval-status value. */
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** One entry in a session's visible Activity stream; `action` rows carry an approval. */
export const SessionActivityOut = z
  .object({
    id: SessionActivityId.describe(
      'The activity entry id — also the SSE event id on `GET /:id/stream`, usable as `Last-Event-ID` to resume.',
    ),
    sessionId: AgentSessionId.describe('The session this entry belongs to.'),
    organizationId: OrganizationId.describe('The organization the session (and entry) belong to.'),
    type: SessionActivityType.describe(
      'The kind of entry (thought/action/response/elicitation/error).',
    ),
    body: z
      .record(z.string(), z.unknown())
      .describe(
        'The type-specific payload: `{ text }` for thought/response/elicitation/error, or `{ action: { kind, summary, diff? } }` for an `action` entry describing the proposed mutation.',
      ),
    approvalStatus: ApprovalStatus.nullable()
      .optional()
      .describe(
        'For `action` entries, the gate state (proposed/approved/rejected/applied); null/absent for non-action entries, which are never gated.',
      ),
    createdAt: z
      .string()
      .describe('ISO-8601 timestamp the entry was appended — the stream sort key (ascending).'),
  })
  .meta({ id: 'SessionActivityOut', description: "An entry in a session's Activity stream." });
/** Session-activity representation value. */
export type SessionActivityOut = z.infer<typeof SessionActivityOut>;

/** An Agent Session summary returned by list reads. */
export const AgentSessionOut = z
  .object({
    id: AgentSessionId.describe('The session id.'),
    organizationId: OrganizationId.describe('The organization the session runs in.'),
    agentId: AgentId.describe(
      'The registered agent this session is bound to (its default agent when started from a prompt with no `agentId`).',
    ),
    taskId: TaskId.nullable()
      .optional()
      .describe(
        'The Docket task the session is working on, when task-bound; null for a freeform-prompt or proactively-drafted session.',
      ),
    trigger: SessionTrigger.describe('Why the session started (assignment/delegation/mention).'),
    status: SessionStatus.describe('Current lifecycle state of the session.'),
    initiatorId: ActorId.nullable()
      .optional()
      .describe(
        'The human Actor who started or is accountable for the session (the prompt author / observation recipient); null when system-initiated.',
      ),
    externalRunRef: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Idempotency key for proactively-created sessions (`observation:<observationId>:<userId>`), enforced by a unique partial index so a re-scan never spawns a duplicate run; null for directly-started sessions.',
      ),
    startedAt: z
      .string()
      .nullable()
      .optional()
      .describe(
        'ISO-8601 instant the session first transitioned to `running`; null while still `pending`.',
      ),
    endedAt: z
      .string()
      .nullable()
      .optional()
      .describe(
        'ISO-8601 instant the session reached a terminal state (`completed`/`canceled`); null while non-terminal.',
      ),
    createdAt: z
      .string()
      .describe('ISO-8601 timestamp the session was created — the list sort key (descending).'),
  })
  .meta({ id: 'AgentSessionOut', description: 'A Docket-hosted agent session.' });
/** Agent-session representation value. */
export type AgentSessionOut = z.infer<typeof AgentSessionOut>;

/** An Agent Session with its full ordered Activity stream (single-session read). */
export const AgentSessionDetailOut = AgentSessionOut.extend({
  activities: z
    .array(SessionActivityOut)
    .describe(
      "The session's full Activity stream, oldest-first — the complete transcript of thoughts, actions, responses, elicitations, and errors.",
    ),
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
    decision: z
      .enum(['approve', 'reject'])
      .describe(
        '`approve` advances the gated action `proposed → applied` (writing an `approved` audit event); `reject` marks it `rejected` and never applies it (writing a `rejected` audit event).',
      ),
    scope: z
      .enum(['this', 'all_in_session'])
      .optional()
      .describe(
        'Whether the decision applies to just the named action (`this`, default) or to every still-`proposed` action in the session (`all_in_session`).',
      ),
  })
  .meta({
    id: 'SessionApprovalDecision',
    description: 'An approver decision on a proposed agent action.',
  });
/** Validated approval-decision body. */
export type SessionApprovalDecision = z.infer<typeof SessionApprovalDecision>;

/**
 * Body for deciding on a whole proposal group (batch approval).
 *
 * @remarks
 * A group is every gated action one assistant turn proposed together ("create these
 * 40 tasks"). `activityIds` narrows the decision to a subset ("approve selected");
 * omitted means the whole group.
 */
export const ProposalGroupDecision = z
  .object({
    activityIds: z
      .array(SessionActivityId)
      .optional()
      .describe(
        'Narrow the decision to these still-`proposed` activities of the group; omitted decides the entire group.',
      ),
  })
  .meta({ id: 'ProposalGroupDecision', description: 'A batch decision on a proposal group.' });
/** Validated proposal-group decision body. */
export type ProposalGroupDecision = z.infer<typeof ProposalGroupDecision>;

/**
 * The ghost projection of one proposed `create_task` — what workspace views render as
 * a translucent, editable task row before approval.
 */
export const GhostTaskOut = z
  .object({
    title: z.string().describe('The proposed task title (editable until approved).'),
    teamId: z.string().nullable().describe('The proposed team, when the input names one.'),
    projectId: z.string().nullable().describe('The proposed project, when the input names one.'),
    dueDate: z.string().nullable().describe('The proposed due date (ISO date), when set.'),
  })
  .meta({ id: 'GhostTaskOut', description: 'The ghost-task projection of a proposal.' });
/** Ghost-task projection value. */
export type GhostTaskOut = z.infer<typeof GhostTaskOut>;

/** One pending proposal, projected for review surfaces (session card + workspace ghosts). */
export const ProposalItemOut = z
  .object({
    activityId: SessionActivityId.describe('The gated `action` activity this proposal lives on.'),
    sessionId: AgentSessionId.describe('The owning session.'),
    proposalGroupId: z.string().describe('The batch this proposal belongs to (one per turn).'),
    tool: z.string().describe('The raw tool the proposal would execute (e.g. `create_task`).'),
    summary: z.string().describe('The human-readable one-line headline.'),
    input: z
      .record(z.string(), z.unknown())
      .describe('The proposed tool input — editable until approved (the ghost-edit target).'),
    mode: z
      .enum(['proposal', 'suggestion'])
      .describe(
        '`proposal` pauses the session until decided; `suggestion` (suggest-only dial) was recorded without pausing.',
      ),
    ghost: GhostTaskOut.nullable().describe(
      'The workspace ghost projection when the proposal has a spatial home (a `create_task`); null falls back to the session proposal card.',
    ),
    createdAt: z.string().describe('ISO-8601 creation instant (group order).'),
  })
  .meta({ id: 'ProposalItemOut', description: 'A pending agent proposal, projected for review.' });
/** Proposal-item projection value. */
export type ProposalItemOut = z.infer<typeof ProposalItemOut>;

/** A pending proposal group: one assistant turn's batch, reviewable as a unit. */
export const ProposalGroupOut = z
  .object({
    proposalGroupId: z.string().describe('The group id every member shares.'),
    sessionId: AgentSessionId.describe('The owning session.'),
    items: z.array(ProposalItemOut).describe('The still-`proposed` members, oldest-first.'),
  })
  .meta({ id: 'ProposalGroupOut', description: 'A pending agent proposal group.' });
/** Proposal-group projection value. */
export type ProposalGroupOut = z.infer<typeof ProposalGroupOut>;

/** Body for editing a pending proposal's tool input (inline ghost editing). */
export const ProposalEditBody = z
  .object({
    input: z
      .record(z.string(), z.unknown())
      .describe('The replacement tool input; the proposal must still be `proposed`.'),
  })
  .meta({ id: 'ProposalEditBody', description: "Edit a pending proposal's input." });
/** Validated proposal-edit body. */
export type ProposalEditBody = z.infer<typeof ProposalEditBody>;

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
    body: z
      .string()
      .min(1)
      .describe(
        "The human reply text answering the agent's elicitation; appended as a `response` activity and (if the session was `awaiting_input`) resumes the run. Non-empty.",
      ),
  })
  .meta({ id: 'SessionReplyBody', description: 'A human reply to a session elicitation.' });
/** Validated session-reply body. */
export type SessionReplyBody = z.infer<typeof SessionReplyBody>;

/**
 * Body for the UI-callable create-and-run-from-prompt session path
 * (`POST /v1/orgs/:orgId/sessions`).
 *
 * @remarks
 * The hybrid Home prompt box's "ask Athena to plan" escalation: a freeform `prompt`
 * becomes the agent's task brief. `agentId` binds the session to a specific registered
 * agent; when omitted the server resolves (lazily creating if needed) the org's default
 * agent so escalation works with no pre-setup. The handler creates the session, threads
 * the prompt through as the brief, runs it against the agent runtime, and returns the
 * settled session.
 */
export const SessionFromPromptBody = z
  .object({
    prompt: z
      .string()
      .min(1)
      .describe(
        "The freeform brief the agent should plan/act against; persisted as the session's first `response` activity and threaded through as the runtime task brief. Non-empty.",
      ),
    agentId: AgentId.optional().describe(
      "Bind to a specific registered agent; when omitted the org's default agent is resolved (lazily created if needed) so escalation works with no pre-setup.",
    ),
  })
  .meta({
    id: 'SessionFromPromptBody',
    description: 'Create and run an agent session from a freeform prompt.',
  });
/** Validated create-from-prompt session body. */
export type SessionFromPromptBody = z.infer<typeof SessionFromPromptBody>;

/**
 * Body for quick-capture (`POST /v1/orgs/:orgId/capture`).
 *
 * @remarks
 * The hybrid Home prompt box's default path: freeform `text` is captured into a task
 * (title derived from the text, assigned to the caller, attached to the current cycle
 * when one is resolvable) without invoking an agent. Escalation to a planned session is
 * the separate {@link SessionFromPromptBody} path.
 */
export const CaptureBody = z
  .object({
    text: z
      .string()
      .min(1)
      .describe(
        'The freeform text to capture. Its first non-empty line (whitespace-collapsed, capped at 120 chars) becomes the task title; the full text becomes the task description. Non-empty.',
      ),
  })
  .meta({ id: 'CaptureBody', description: 'Quick-capture freeform text into a task.' });
/** Validated quick-capture body. */
export type CaptureBody = z.infer<typeof CaptureBody>;
