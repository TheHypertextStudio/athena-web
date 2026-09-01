/**
 * `@docket/api` — the data-driven approval-policy engine (the three-dial trust model).
 *
 * @remarks
 * Pure — no DB, no I/O. Decides what the agentic loop does with one model-requested
 * tool call: `execute` it now, persist it as a `propose`d action awaiting human
 * approval, or `record_only` (a suggestion that never executes). The decision is a
 * table lookup keyed by the agent's {@link ApprovalPolicy} dial × the tool's
 * read/write classification — never a hardcoded tool-name list. Classification comes
 * from MCP `tools/list` **annotations** (`readOnlyHint`), the same metadata every MCP
 * client sees, and **fails closed**: a tool that does not declare itself read-only is
 * treated as a write, so an unannotated remote tool can never slip past the gate.
 *
 * Reads always execute under every dial — the dial gates mutation, not observation;
 * that is what keeps a session under "Ask first" feeling alive rather than stalling
 * on every lookup.
 */
import type { ApprovalPolicy } from '@docket/athena/agent-contract';
import type { AthenaApprovalMode } from '@docket/planning/hub-preferences-contract';

/** The MCP tool-annotation hints the classifier reads (a subset of `ToolAnnotations`). */
export interface ToolAnnotationHints {
  /** Whether the tool declares itself side-effect free. */
  readonly readOnlyHint?: boolean | undefined;
  /** Whether the tool declares destructive updates (vs additive). */
  readonly destructiveHint?: boolean | undefined;
  /** Whether the tool reaches outside Docket (e.g. a remote MCP connection). */
  readonly openWorldHint?: boolean | undefined;
}

/** A tool's gate-relevant classification, derived purely from its annotations. */
export interface ToolClassification {
  /** True only when the tool explicitly declares `readOnlyHint: true`. */
  readonly readOnly: boolean;
  /** The declared destructive hint (false when undeclared). */
  readonly destructive: boolean;
  /** The declared open-world hint (false when undeclared). */
  readonly openWorld: boolean;
}

/**
 * Who wrote a tool's annotations.
 *
 * @remarks
 * `first_party` annotations are hardcoded at registration in this repo (`content-tools.ts`,
 * `archive-tool.ts`, `session-tools.ts`, …) and are as trustworthy as the code around them.
 * `remote` annotations arrive over the wire from a server the user connected, which means the
 * subject of the decision is also its author.
 */
export type ToolAnnotationSource = 'first_party' | 'remote';

/** What the loop does with one tool call. */
export type ToolDecision = 'execute' | 'propose' | 'record_only';

/**
 * Classify a tool from its MCP annotations, failing closed.
 *
 * @remarks
 * Failing closed on an *absent* annotation was never the hard part. The gap was a *false* one:
 * `readOnlyHint` decided whether a call executed unreviewed under every dial, and for a remote
 * tool that flag is written by the same server the flag is protecting the user from. A connected
 * server could declare `readOnlyHint: true` on a tool that exfiltrates and have it run with no
 * proposal under `suggest`, `act_with_approval`, and `autonomous` alike.
 *
 * So a remote tool is never read-only here, whatever it says about itself. It can still be called;
 * it just goes through the same gate as any other write. This costs remote *genuine* reads an
 * approval prompt, which is a real usability loss and the reason `permissions.md` already describes
 * these annotations as "advisory UI hints, not an authorization substitute" — this makes the code
 * agree with that sentence. The other two hints stay honoured: they can only ever make the gate
 * stricter, so a lying server gains nothing by setting them.
 *
 * @param annotations - The tool's `tools/list` annotations, when it declared any.
 * @param source - Who authored those annotations; see {@link ToolAnnotationSource}.
 * @returns the {@link ToolClassification}; absent/undeclared hints classify as a
 *   non-read-only, non-destructive, closed-world tool — i.e. a gated write.
 */
export function classifyTool(
  annotations: ToolAnnotationHints | undefined,
  source: ToolAnnotationSource,
): ToolClassification {
  return {
    readOnly: source === 'first_party' && annotations?.readOnlyHint === true,
    destructive: annotations?.destructiveHint === true,
    openWorld: annotations?.openWorldHint === true,
  };
}

/**
 * The policy table: one row per approval dial, one column per read/write class.
 *
 * @remarks
 * `suggest` — reads run, writes are recorded as suggestions and never execute.
 * `act_with_approval` (default) — reads run, writes pause the loop as proposals;
 * approval executes them. `autonomous` — everything runs (still fully audited).
 */
const POLICY_TABLE: Readonly<
  Record<ApprovalPolicy, Readonly<{ read: ToolDecision; write: ToolDecision }>>
> = {
  suggest: { read: 'execute', write: 'record_only' },
  act_with_approval: { read: 'execute', write: 'propose' },
  autonomous: { read: 'execute', write: 'execute' },
};

/**
 * Decide what the loop does with one tool call under the agent's approval dial.
 *
 * @param policy - The agent's configured {@link ApprovalPolicy}.
 * @param classification - The tool's {@link ToolClassification}.
 * @returns the {@link ToolDecision} the loop must enact.
 */
export function decideToolExecution(
  policy: ApprovalPolicy,
  classification: ToolClassification,
): ToolDecision {
  const row = POLICY_TABLE[policy];
  return classification.readOnly ? row.read : row.write;
}

/**
 * Apply the signed-in principal's global Athena policy as a ceiling over workspace agent policy.
 *
 * @remarks
 * A personal preference may make a workspace agent stricter but never more permissive. Routine
 * autonomy only executes closed-world, non-destructive writes when the workspace agent is already
 * autonomous; destructive or external writes still require approval.
 */
export function decideUserOwnedToolExecution(
  agentPolicy: ApprovalPolicy,
  personalMode: AthenaApprovalMode,
  classification: ToolClassification,
): ToolDecision {
  const workspaceDecision = decideToolExecution(agentPolicy, classification);
  if (classification.readOnly || workspaceDecision !== 'execute') return workspaceDecision;
  if (personalMode === 'suggest_only') return 'record_only';
  if (personalMode === 'ask_before_acting') return 'propose';
  return classification.destructive || classification.openWorld ? 'propose' : 'execute';
}
