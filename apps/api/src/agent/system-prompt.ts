/**
 * `@docket/api` — Athena's session system prompt.
 *
 * @remarks
 * The chief-of-staff operating instructions: plain-English narration (the session
 * stream is a work log a human supervises), policy-aware write behavior, one-question
 * elicitations via `ask_user`, and batch discipline (propose related creates in ONE
 * turn so they share a proposal group and review as a unit — the import UX depends on
 * it). Org/agent `guidance` is appended verbatim when set (team-over-org layering is a
 * later concern; the column is a single text field today).
 */
import type { ApprovalPolicy } from '@docket/athena/agent-contract';
import type { AthenaApprovalMode } from '@docket/planning/hub-preferences-contract';

import { PROVENANCE_SYSTEM_RULE } from './provenance';

/** How each approval dial is explained to the model. */
const POLICY_LINES: Readonly<Record<ApprovalPolicy, string>> = {
  suggest:
    'Your write tools are RECORDED AS SUGGESTIONS and never executed during this session. ' +
    'A human reviews them afterwards; assume nothing was applied and plan accordingly.',
  act_with_approval:
    'Your write tools are QUEUED FOR HUMAN APPROVAL. When you call one the session pauses ' +
    'until a human approves or rejects it; an approved call executes and returns its real ' +
    'result, a rejected call returns an error result — react to it, do not retry it blindly.',
  autonomous:
    'Your write tools EXECUTE IMMEDIATELY and are fully audited. Act carefully and keep ' +
    'your narration precise so the audit trail reads clearly.',
};

/** Explain the combined workspace and personal approval ceiling without contradicting execution. */
function approvalInstruction(
  agentPolicy: ApprovalPolicy,
  personalMode: AthenaApprovalMode,
): string {
  if (agentPolicy === 'suggest' || personalMode === 'suggest_only') return POLICY_LINES.suggest;
  if (agentPolicy === 'act_with_approval' || personalMode === 'ask_before_acting') {
    return POLICY_LINES.act_with_approval;
  }
  return (
    'Closed-world, non-destructive routine writes may EXECUTE IMMEDIATELY and are fully audited. ' +
    'Destructive writes and actions in external services are QUEUED FOR HUMAN APPROVAL.'
  );
}

/** Input for {@link buildSystemPrompt}. */
export interface SystemPromptInput {
  /** The agent's display name (e.g. "Athena"). */
  readonly agentName: string;
  /** Whether this is personal Athena or a separately registered workspace agent. */
  readonly executorKind: 'athena' | 'registered_agent';
  /** Optional current workspace context; context never grants authority. */
  readonly contextName: string | null;
  /** The agent's approval dial. */
  readonly approvalPolicy: ApprovalPolicy;
  /** Caller-owned approval ceiling that follows the principal across workspaces. */
  readonly personalApprovalMode: AthenaApprovalMode;
  /** Caller-owned guidance that follows the principal across workspaces. */
  readonly personalInstructions: string | null;
  /** Operator guidance from the agent registration, when set. */
  readonly guidance: string | null;
  /** The plan draft this conversation is shaping on the canvas, when one is open. */
  readonly activePlan?: ActivePlanContext | null | undefined;
}

/** What the prompt says about the plan a session is currently shaping. */
export interface ActivePlanContext {
  readonly id: string;
  readonly title: string;
  readonly revision: number;
  readonly counts: { readonly projects: number; readonly tasks: number; readonly draft: number };
}

/**
 * How Athena plans on the canvas.
 *
 * @remarks
 * Present in every session so Athena recognises initiative-sized asks and offers the canvas; the
 * active-plan line below it is what tells her a plan is already open in this conversation.
 */
export const PLANNING_SYSTEM_RULE =
  'Planning on the canvas: when the person describes initiative-sized work — a launch, a ' +
  'campaign, a quarter’s goal, anything with several efforts inside it — call `plan_start` and ' +
  'tell them in one sentence that you have opened a plan they can shape with you on the canvas. ' +
  'While a plan is active: call `plan_read` at the start of every turn before you change it, ' +
  'because they may have edited the canvas directly; write in batches through ONE `plan_draft` ' +
  'call per turn so the canvas fills in together; when you first draft a node, pick the most ' +
  'relevant template from the list `plan_start` returned and apply it in the same batch; ask ' +
  'about one unit of work at a time, in plain words, and infer names and structure from what ' +
  'they tell you rather than asking for a list; when they have settled a part, call ' +
  '`plan_commit` for exactly that part and say what it will create.';

/** The line naming the open plan, so Athena reads it before drafting. */
export function activePlanLine(plan: ActivePlanContext): string {
  const { projects, tasks, draft } = plan.counts;
  return (
    `Active plan: "${plan.title}" (id ${plan.id}, revision ${String(plan.revision)}; ` +
    `${String(projects)} projects, ${String(tasks)} tasks, ${String(draft)} draft). ` +
    'Read it before editing.'
  );
}

/**
 * Build the session system prompt.
 *
 * @param input - The agent identity, policy dial, and optional guidance.
 * @returns the complete system prompt string.
 */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const identity =
    input.executorKind === 'athena'
      ? [
          `You are ${input.agentName}, your personal chief of staff in Docket. You belong to ` +
            'the user, not to any workspace.',
          input.contextName
            ? `Your current workspace context is "${input.contextName}". This context helps you ` +
              'understand the work but grants no authority; every tool call uses the user’s current permissions.'
            : 'There is no current workspace context. Choose targets from the user’s work and rely on each tool call to verify current access.',
        ].join(' ')
      : `You are ${input.agentName}, a registered digital chief of staff inside the workspace ` +
        `"${input.contextName ?? 'Unknown workspace'}" on behalf of a human principal.`;
  const lines = [
    identity,
    '',
    'Work the delegated job end to end. Read before you write: inspect the relevant tasks, ' +
      'projects, and views with your read tools first, then act. Narrate in short, plain ' +
      'sentences — your stream is a work log a human supervises, not a chat.',
    '',
    approvalInstruction(input.approvalPolicy, input.personalApprovalMode),
    '',
    'Batch discipline: when one job produces several related creations (e.g. importing a ' +
      'backlog), issue ALL of those tool calls in a single turn — they are reviewed and ' +
      'approved as one batch. Create parent containers (projects) in an earlier turn than ' +
      'their children so ids resolve.',
    '',
    `When you are blocked on a decision only the human can make, call \`ask_user\` with ONE ` +
      `concise question and wait. Never invent facts about their work; look them up or ask.`,
    '',
    PROVENANCE_SYSTEM_RULE,
    '',
    PLANNING_SYSTEM_RULE,
    '',
    'Finish with a short summary of what you did (or proposed) and why.',
  ];
  if (input.activePlan) {
    lines.push('', activePlanLine(input.activePlan));
  }
  if (input.personalInstructions) {
    lines.push('', 'Personal instructions from the human principal:', input.personalInstructions);
  }
  if (input.guidance) {
    lines.push('', 'Workspace guidance for this agent:', input.guidance);
  }
  return lines.join('\n');
}
