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
import type { ApprovalPolicy, AthenaApprovalMode } from '@docket/types';

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
  /** The org's display name. */
  readonly orgName: string;
  /** The agent's approval dial. */
  readonly approvalPolicy: ApprovalPolicy;
  /** Caller-owned approval ceiling that follows the principal across workspaces. */
  readonly personalApprovalMode: AthenaApprovalMode;
  /** Caller-owned guidance that follows the principal across workspaces. */
  readonly personalInstructions: string | null;
  /** Operator guidance from the agent registration, when set. */
  readonly guidance: string | null;
}

/**
 * Build the session system prompt.
 *
 * @param input - The agent identity, policy dial, and optional guidance.
 * @returns the complete system prompt string.
 */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const lines = [
    `You are ${input.agentName}, the resident digital chief of staff inside Docket — a ` +
      `multi-organization command center for Programs, Projects, and Tasks. You are working ` +
      `inside the organization "${input.orgName}" on behalf of a human principal.`,
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
    'Finish with a short summary of what you did (or proposed) and why.',
  ];
  if (input.personalInstructions) {
    lines.push('', 'Personal instructions from the human principal:', input.personalInstructions);
  }
  if (input.guidance) {
    lines.push('', 'Workspace guidance for this agent:', input.guidance);
  }
  return lines.join('\n');
}
