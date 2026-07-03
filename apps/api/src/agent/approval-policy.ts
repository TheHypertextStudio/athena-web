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
import type { ApprovalPolicy } from '@docket/types';

/** The MCP tool-annotation hints the classifier reads (a subset of `ToolAnnotations`). */
export interface ToolAnnotationHints {
  /** Whether the tool declares itself side-effect free. */
  readonly readOnlyHint?: boolean;
  /** Whether the tool declares destructive updates (vs additive). */
  readonly destructiveHint?: boolean;
  /** Whether the tool reaches outside Docket (e.g. a remote MCP connection). */
  readonly openWorldHint?: boolean;
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

/** What the loop does with one tool call. */
export type ToolDecision = 'execute' | 'propose' | 'record_only';

/**
 * Classify a tool from its MCP annotations, failing closed.
 *
 * @param annotations - The tool's `tools/list` annotations, when it declared any.
 * @returns the {@link ToolClassification}; absent/undeclared hints classify as a
 *   non-read-only, non-destructive, closed-world tool — i.e. a gated write.
 */
export function classifyTool(annotations: ToolAnnotationHints | undefined): ToolClassification {
  return {
    readOnly: annotations?.readOnlyHint === true,
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
