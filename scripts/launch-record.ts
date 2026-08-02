/**
 * `pnpm launch:record` — the launch ledger. One tool, one answer.
 *
 * @remarks
 * The launch is graded against `docs/engineering/launch-compliance.json`, an audited,
 * **read-only** baseline of every requirement derived from the launch plan. Workers claim
 * requirements by writing a slice file under `docs/engineering/launch/slices/`. This module
 * reconciles those claims against the baseline and writes both launch artifacts:
 * `docs/engineering/launch/launch-record.json` (machine-readable) and
 * `docs/engineering/launch/launch-checklist.md` (its rendering).
 *
 * **Why one tool.** There were two. A second generator at `scripts/launch-compliance-record.ts`
 * projected the same baseline into the record while this one reconciled the slice files into a
 * separate `checklist.md`, and each was internally consistent — so each had its own green test and
 * neither looked broken. They still disagreed: `launch:record` reported `closed=12` and
 * `launch:compliance-record` reported `closed=10` on the same tree, because `GEN-07` and `GEN-23`
 * were graded `pass` by `slices/security-and-domains.md` and left `not-started` in the record.
 * Two ledgers meant two answers to "how much of the launch is done?", and a reader believed
 * whichever they opened first. The duplication is now gone rather than documented.
 *
 * **What is derived, and why that is the fix.** `owner`, `claim`, `state`, `verifiedBy`, and
 * `verificationArtifacts` are computed from the slice files on every run. They cannot be
 * hand-edited into disagreement with the slices, because regeneration overwrites them and the
 * freshness test compares the file on disk to this tool's output. Only genuinely human-authored
 * fields — `evidence`, `worklogAnchor`, `blockedReason`, `questions`, `externalSystems` — carry
 * across untouched.
 *
 * **The verification gate (GEN-09).** A requirement reaches `closed` only when its slice claims
 * `pass` *and* that slice names an independent verifier with at least one artifact that verifier
 * produced, under one of the verifier-owned evidence roots and actually present on disk. A slice
 * that verifies itself, or cites artifacts its own implementer wrote, does not close anything.
 * The gap between "claimed `pass`" and "closed" is reported on every run rather than left for a
 * second ledger to disagree about.
 *
 * Two modes (see `docs/engineering/launch/README.md`):
 *
 * - **structural** (default) — every slice file parses, no requirement is claimed by two slices,
 *   no slice claims an id the baseline does not define, and every slice's verification holds.
 *   This must pass on every commit of the launch branch.
 * - **sign-off** (`--sign-off`) — additionally every one of the baseline's requirements is
 *   claimed by exactly one slice **and** closed `pass`. This is the GEN-01 gate and exits
 *   non-zero while any requirement is still open. It is expected to fail until the whole
 *   launch lands; a green sign-off must never be manufactured by relaxing this function.
 *
 * @see `docs/engineering/launch/README.md` for the slice-file contract and regeneration steps.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildLaunchRecord,
  LAUNCH_CHECKLIST_PATH,
  LAUNCH_RECORD_PATH,
  namesSameAgent,
  renderChecklistMarkdown,
  signOffViolations,
  VERIFIER_EVIDENCE_ROOTS,
  type ComplianceRequirement,
  type LaunchEntryState,
  type LaunchRecord,
  type LaunchRecordEntry,
} from '../packages/test-utils/tests/launch-policies/launch-record-schema';

/** Repository root, resolved from this file rather than the caller's cwd. */
export const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The audited requirement baseline. Read-only: no tool in this repo may rewrite it. */
export const BASELINE_PATH: string = join(REPO_ROOT, 'docs/engineering/launch-compliance.json');

/** Directory holding one Markdown slice file per worker. */
export const SLICES_DIR: string = join(REPO_ROOT, 'docs/engineering/launch/slices');

/** How a requirement is verified, per the baseline. */
export type VerifyBy =
  | 'doc-exists'
  | 'automated-test'
  | 'code-inspection'
  | 'screenshot'
  | 'manual-interaction'
  | 'api-call';

/** Requirement severity, per the baseline. */
export type Severity = 'launch-blocker' | 'high' | 'medium' | 'low';

/** The five disposition values shared by the baseline and every slice claim. */
export type LaunchOutcome = 'pass' | 'partial' | 'fail' | 'not-built' | 'unverifiable';

/** The five values a slice may record in its `outcomes` map. */
export const LAUNCH_OUTCOMES: readonly LaunchOutcome[] = [
  'pass',
  'partial',
  'fail',
  'not-built',
  'unverifiable',
];

/** One audited requirement from `docs/engineering/launch-compliance.json`. */
export interface LaunchRequirement {
  /** Stable requirement id, e.g. `GEN-01`. */
  readonly id: string;
  /** Product area the requirement belongs to. */
  readonly area: string;
  /** The requirement in plain language. */
  readonly requirement: string;
  /** The launch-plan sentence the requirement was derived from. */
  readonly sourceQuote: string;
  /** How the requirement is to be verified. */
  readonly verifyBy: VerifyBy;
  /** The literal bar the requirement must clear. */
  readonly acceptance: string;
  /** Severity assigned by the audit. */
  readonly severity: Severity;
  /** The audited baseline status at the time the baseline was captured. */
  readonly status: LaunchOutcome;
  /** The audit's evidence for {@link status}. */
  readonly evidence: string;
  /** Optional auditor commentary. */
  readonly notes?: string;
}

/** One worker's slice file: the canonical record of what that worker shipped. */
export interface LaunchSlice {
  /** Slice id; matches the file's basename. */
  readonly slice: string;
  /** Branch the slice was delivered on. */
  readonly branch: string;
  /** Requirement ids the slice claims. */
  readonly requirementIds: readonly string[];
  /** Claimed disposition per requirement id. */
  readonly outcomes: Readonly<Record<string, LaunchOutcome>>;
  /** Files the slice changed. */
  readonly filesChanged: readonly string[];
  /** The command(s) run to verify the slice, with their real output. */
  readonly verification: string;
  /**
   * The subagent that independently checked this slice. Must not be the implementer.
   *
   * @remarks
   * GEN-09 asks that "each work slice's record names the verification subagent that checked it".
   * The record used to satisfy that one layer up, in `launch-record.json`'s `verifiedBy` — which
   * meant the slice files themselves, the thing the requirement actually names, carried no
   * verifier at all: two of four had no verification field whatsoever and the other two listed
   * commands their own implementer had run. Putting it in the slice contract is what makes the
   * requirement checkable by a parser instead of by a reader's goodwill.
   */
  readonly verifier: string;
  /**
   * Paths the verifier produced, relative to the repository root.
   *
   * @remarks
   * At least one must sit under a verifier-owned evidence root and exist on disk; see
   * {@link sliceVerificationProblems}. An implementer's own green test run is not an artifact —
   * the whole point is output that someone other than the author generated.
   */
  readonly verifierArtifacts: readonly string[];
  /** Repo-relative path the slice was parsed from. */
  readonly sourcePath: string;
}

/** One requirement after baseline and slice claims are reconciled. */
export interface ReconciledRequirement {
  /** Requirement id. */
  readonly id: string;
  /** Product area, copied from the baseline. */
  readonly area: string;
  /** Severity, copied from the baseline. */
  readonly severity: Severity;
  /** The audited baseline status. */
  readonly baselineStatus: LaunchOutcome;
  /** Slice ids claiming this requirement, in file order. Empty when unclaimed. */
  readonly claimedBy: readonly string[];
  /**
   * The claimed disposition.
   *
   * @remarks
   * `null` when unclaimed. Should two slices ever claim one id — now a reported structural
   * error, not an allowed split — the **weakest** claim wins, so a duplicate cannot make the
   * record read better than its worst claimant while it is being cleaned up.
   */
  readonly claimedOutcome: LaunchOutcome | null;
  /**
   * The slice that produced {@link claimedOutcome}; `null` when unclaimed.
   *
   * @remarks
   * The record derives `owner`, `verifiedBy`, and `verificationArtifacts` from this slice rather
   * than from the first claimant, so the entry names whoever is actually holding the requirement
   * open. With duplicates outlawed the two coincide for every requirement; the distinction still
   * matters during the window where a duplicate exists and has not yet been removed, because
   * pointing at the strongest claimant would credit the requirement to a slice whose clause is
   * not the one still outstanding.
   */
  readonly weakestSlice: string | null;
}

/** A requirement claimed by more than one slice. */
export interface DoubleClaim {
  /** The doubly-claimed requirement id. */
  readonly id: string;
  /** The slice ids claiming it. */
  readonly slices: readonly string[];
}

/** A slice claim that does not correspond to any baseline requirement. */
export interface UnknownClaim {
  /** The unrecognized requirement id. */
  readonly id: string;
  /** The slice that claimed it. */
  readonly slice: string;
}

/** The full reconciliation of baseline against slice claims. */
export interface ReconcileResult {
  /** One row per baseline requirement, in baseline order. */
  readonly rows: readonly ReconciledRequirement[];
  /** Baseline ids no slice claims. */
  readonly unclaimed: readonly string[];
  /** Ids claimed by more than one slice. Never empty-by-exemption: there is no allowlist. */
  readonly doublyClaimed: readonly DoubleClaim[];
  /** Ids claimed by a slice that the baseline does not define. */
  readonly unknownClaims: readonly UnknownClaim[];
  /** Slice ids that participated in the reconciliation, in load order. */
  readonly slices: readonly string[];
}

/** Why a requirement blocks sign-off. */
export type SignOffReason = 'unclaimed' | LaunchOutcome;

/** One requirement standing between the launch and sign-off. */
export interface SignOffItem {
  /** The requirement id. */
  readonly id: string;
  /** Severity, so the report can be read worst-first. */
  readonly severity: Severity;
  /** Why it is open. */
  readonly reason: SignOffReason;
}

/** The GEN-01 sign-off tally. */
export interface SignOffReport {
  /** Total baseline requirements considered. */
  readonly total: number;
  /** Requirements closed `pass` by exactly one slice. */
  readonly closed: number;
  /** Every open requirement, severity-ordered then id-ordered. */
  readonly open: readonly SignOffItem[];
  /** Count of {@link open}. GEN-01 requires this to be zero at sign-off. */
  readonly openCount: number;
  /** Open counts grouped by reason. */
  readonly byReason: Readonly<Record<SignOffReason, number>>;
  /** True only when {@link openCount} is zero. */
  readonly clean: boolean;
}

/** A slice file that could not be parsed into a {@link LaunchSlice}. */
export class SliceParseError extends Error {
  /** Repo-relative path of the offending slice file. */
  readonly sourcePath: string;

  /**
   * @param sourcePath - Repo-relative path of the offending file.
   * @param message - What is wrong with the frontmatter.
   */
  constructor(sourcePath: string, message: string) {
    super(`${sourcePath}: ${message}`);
    this.name = 'SliceParseError';
    this.sourcePath = sourcePath;
  }
}

/** A parsed frontmatter value: scalar, list, or one level of nested map. */
type FrontmatterValue = string | readonly string[] | Readonly<Record<string, string>>;

/** Strip matching surrounding quotes from a YAML scalar. */
function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" || first === '"') && first === last) return value.slice(1, -1);
  }
  return value;
}

/** Parse a YAML flow sequence (`[a, b, c]`) into its trimmed, unquoted members. */
function parseFlowList(raw: string): readonly string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((part) => unquote(part));
}

/**
 * Parse the YAML frontmatter block of a slice file.
 *
 * @remarks
 * Deliberately a small strict parser rather than a YAML dependency: the slice contract is a
 * fixed, flat shape (scalars, one flow/block list per key, one single-level map), and a
 * strict reader that *rejects* anything outside that shape is a better gate than a permissive
 * one that silently accepts a malformed record. Anything unrecognized raises
 * {@link SliceParseError}.
 *
 * @param text - The full slice-file contents, starting with `---`.
 * @param sourcePath - Repo-relative path, used in error messages.
 * @returns the frontmatter keys mapped to scalars, string lists, or one-level string maps.
 * @throws {SliceParseError} When the block is absent, unterminated, or not in the fixed shape.
 */
export function parseFrontmatterBlock(
  text: string,
  sourcePath: string,
): Readonly<Record<string, FrontmatterValue>> {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new SliceParseError(sourcePath, 'file must begin with a `---` frontmatter fence');
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) throw new SliceParseError(sourcePath, 'frontmatter fence is never closed');

  const parsed: Record<string, FrontmatterValue> = {};
  let index = 1;
  while (index < end) {
    const line = lines[index] ?? '';
    index += 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      throw new SliceParseError(sourcePath, `unexpected indented line ${String(index)}: ${line}`);
    }
    const colon = line.indexOf(':');
    if (colon === -1) throw new SliceParseError(sourcePath, `line ${String(index)} is not a key`);
    const key = line.slice(0, colon).trim();
    if (key === '') throw new SliceParseError(sourcePath, `line ${String(index)} has an empty key`);
    if (key in parsed) throw new SliceParseError(sourcePath, `duplicate key \`${key}\``);
    const inline = line.slice(colon + 1).trim();

    if (inline.startsWith('[') && inline.endsWith(']')) {
      parsed[key] = parseFlowList(inline);
      continue;
    }
    if (inline !== '') {
      parsed[key] = unquote(inline);
      continue;
    }

    // Block form: either `  - item` entries or `  sub: value` entries, never both.
    const listItems: string[] = [];
    const mapEntries: Record<string, string> = {};
    let sawList = false;
    let sawMap = false;
    while (index < end) {
      const child = lines[index] ?? '';
      if (child.trim() === '') {
        index += 1;
        continue;
      }
      if (!/^\s/.test(child)) break;
      index += 1;
      const body = child.trim();
      if (body.startsWith('- ')) {
        if (sawMap) throw new SliceParseError(sourcePath, `\`${key}\` mixes list and map entries`);
        sawList = true;
        listItems.push(unquote(body.slice(2)));
        continue;
      }
      const childColon = body.indexOf(':');
      if (childColon === -1) {
        throw new SliceParseError(sourcePath, `\`${key}\` has an unparseable entry: ${body}`);
      }
      if (sawList) throw new SliceParseError(sourcePath, `\`${key}\` mixes list and map entries`);
      sawMap = true;
      const childKey = body.slice(0, childColon).trim();
      if (childKey in mapEntries) {
        throw new SliceParseError(sourcePath, `\`${key}\` repeats the entry \`${childKey}\``);
      }
      mapEntries[childKey] = unquote(body.slice(childColon + 1));
    }
    if (sawMap) parsed[key] = mapEntries;
    else if (sawList) parsed[key] = listItems;
    else throw new SliceParseError(sourcePath, `\`${key}\` has no value`);
  }
  return parsed;
}

/** Read a required scalar frontmatter field. */
function requireScalar(
  parsed: Readonly<Record<string, FrontmatterValue>>,
  key: string,
  sourcePath: string,
): string {
  const value = parsed[key];
  if (typeof value !== 'string' || value === '') {
    throw new SliceParseError(sourcePath, `\`${key}\` must be a non-empty scalar`);
  }
  return value;
}

/** Read a required list frontmatter field. */
function requireList(
  parsed: Readonly<Record<string, FrontmatterValue>>,
  key: string,
  sourcePath: string,
): readonly string[] {
  const value = parsed[key];
  if (!Array.isArray(value)) {
    throw new SliceParseError(sourcePath, `\`${key}\` must be a list`);
  }
  return value as readonly string[];
}

/** Narrow an arbitrary string to a {@link LaunchOutcome}. */
function asOutcome(value: string, sourcePath: string, id: string): LaunchOutcome {
  const found = LAUNCH_OUTCOMES.find((candidate) => candidate === value);
  if (!found) {
    throw new SliceParseError(
      sourcePath,
      `outcome for \`${id}\` is \`${value}\`; expected one of ${LAUNCH_OUTCOMES.join(' | ')}`,
    );
  }
  return found;
}

/**
 * Parse one slice file into a {@link LaunchSlice}.
 *
 * @remarks
 * Enforces the slice contract beyond mere YAML validity: `requirementIds` must be non-empty,
 * every listed id must have an `outcomes` entry, and `outcomes` may not name an id the slice
 * did not list. These are the exact bookkeeping errors that let a requirement quietly go
 * unowned, so they are parse failures rather than warnings.
 *
 * @param text - The slice file's contents.
 * @param sourcePath - Repo-relative path, used in error messages.
 * @returns the parsed slice.
 * @throws {SliceParseError} When any part of the contract is violated.
 */
export function parseSlice(text: string, sourcePath: string): LaunchSlice {
  const parsed = parseFrontmatterBlock(text, sourcePath);
  const slice = requireScalar(parsed, 'slice', sourcePath);
  const branch = requireScalar(parsed, 'branch', sourcePath);
  const verification = requireScalar(parsed, 'verification', sourcePath);
  const verifier = requireScalar(parsed, 'verifier', sourcePath);
  const requirementIds = requireList(parsed, 'requirementIds', sourcePath);
  const filesChanged = requireList(parsed, 'filesChanged', sourcePath);
  const verifierArtifacts = requireList(parsed, 'verifierArtifacts', sourcePath);

  if (requirementIds.length === 0) {
    throw new SliceParseError(sourcePath, '`requirementIds` must claim at least one requirement');
  }
  if (verifierArtifacts.length === 0) {
    throw new SliceParseError(
      sourcePath,
      '`verifierArtifacts` must name at least one artifact the verifier produced',
    );
  }
  if (namesSameAgent(slice, verifier)) {
    throw new SliceParseError(
      sourcePath,
      `\`verifier\` is "${verifier}", which names the same agent as the slice "${slice}" — ` +
        'GEN-09 requires a subagent other than the implementer',
    );
  }
  const rawOutcomes = parsed['outcomes'];
  if (rawOutcomes === undefined || typeof rawOutcomes === 'string' || Array.isArray(rawOutcomes)) {
    throw new SliceParseError(sourcePath, '`outcomes` must be a map of requirement id to outcome');
  }
  const outcomeMap = rawOutcomes as Readonly<Record<string, string>>;

  const outcomes: Record<string, LaunchOutcome> = {};
  const seen = new Set<string>();
  for (const id of requirementIds) {
    if (seen.has(id)) throw new SliceParseError(sourcePath, `\`${id}\` is listed twice`);
    seen.add(id);
    const raw = outcomeMap[id];
    if (raw === undefined) {
      throw new SliceParseError(sourcePath, `\`${id}\` is claimed but has no \`outcomes\` entry`);
    }
    outcomes[id] = asOutcome(raw, sourcePath, id);
  }
  for (const id of Object.keys(outcomeMap)) {
    if (!seen.has(id)) {
      throw new SliceParseError(sourcePath, `\`outcomes\` names \`${id}\`, which is not claimed`);
    }
  }

  return {
    slice,
    branch,
    requirementIds,
    outcomes,
    filesChanged,
    verification,
    verifier,
    verifierArtifacts,
    sourcePath,
  };
}

/**
 * Grade each slice's declared verification against GEN-09.
 *
 * @remarks
 * {@link parseSlice} already rejects a missing verifier, an empty artifact list, and a verifier
 * that is the implementer under another name — those are shape errors and belong at the parse
 * boundary. This function checks the two things a parser cannot see: that a cited artifact is
 * really on disk, and that at least one of them sits under a root only a verifier writes to
 * ({@link VERIFIER_EVIDENCE_ROOTS}). A slice may cite its own source files alongside the
 * verifier's output; it may not cite *only* them, because a record whose every artifact was
 * written by the implementer proves nothing about independence.
 *
 * Existence is injected rather than read directly so the rule can be proved against fixtures in
 * both directions instead of only observed against whatever happens to be on disk today.
 *
 * @param slices - The parsed slice files.
 * @param artifactExists - Whether a repo-root-relative path is present on disk.
 * @returns One human-readable line per problem; empty when every slice's verification holds.
 */
export function sliceVerificationProblems(
  slices: readonly LaunchSlice[],
  artifactExists: (artifact: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const slice of slices) {
    for (const artifact of slice.verifierArtifacts) {
      if (!artifactExists(artifact)) {
        problems.push(`${slice.slice} cites a verifier artifact that is not on disk: ${artifact}`);
      }
    }
    const verifierProduced = slice.verifierArtifacts.filter(
      (artifact) =>
        VERIFIER_EVIDENCE_ROOTS.some((root) => artifact.startsWith(root)) &&
        artifactExists(artifact),
    );
    if (verifierProduced.length === 0) {
      problems.push(
        `${slice.slice} cites no verifier-produced artifact; GEN-09 needs output the verifier ` +
          `generated under one of ${VERIFIER_EVIDENCE_ROOTS.join(', ')}`,
      );
    }
  }
  return problems;
}

/**
 * The slices whose verification holds, and whose `pass` claims may therefore close a requirement.
 *
 * @param slices - The parsed slice files.
 * @param artifactExists - Whether a repo-root-relative path is present on disk.
 * @returns The ids of slices with an independent verifier and a real verifier-produced artifact.
 */
export function verifiedSlices(
  slices: readonly LaunchSlice[],
  artifactExists: (artifact: string) => boolean,
): ReadonlySet<string> {
  const verified = new Set<string>();
  for (const slice of slices) {
    if (sliceVerificationProblems([slice], artifactExists).length === 0) {
      verified.add(slice.slice);
    }
  }
  return verified;
}

/**
 * Load the audited requirement baseline.
 *
 * @param baselinePath - Override for the baseline JSON path; defaults to {@link BASELINE_PATH}.
 * @returns every requirement, in the baseline's own order.
 */
export function loadRequirements(
  baselinePath: string = BASELINE_PATH,
): readonly LaunchRequirement[] {
  const parsed: unknown = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${baselinePath} must contain a JSON array`);
  return parsed as readonly LaunchRequirement[];
}

/**
 * Load every slice file in a directory.
 *
 * @remarks
 * Files are loaded in sorted filename order so reconciliation is deterministic regardless of
 * the filesystem's directory ordering. A missing directory yields no slices — that is the
 * legitimate state before the first worker lands, not an error.
 *
 * A file here that is not Markdown is a **hard error rather than a skip**, and the difference
 * matters more than it looks. This lane briefed one worker on a `slices/<slug>.json` shape and the
 * other three on `.md`; the JSON worker filed a complete 50 KB record that this function quietly
 * filtered out, so its slice was absent from `checklist.md` while its author had every reason to
 * believe it was filed. Silently ignoring a file in a directory whose entire purpose is to be read
 * is how a worker's whole slice goes missing without anyone seeing a failure.
 *
 * @param slicesDir - Override for the slices directory; defaults to {@link SLICES_DIR}.
 * @returns the parsed slices.
 * @throws {SliceParseError} When any slice file violates the contract, or when the directory holds
 * an entry the reconciler cannot read.
 */
export function loadSlices(slicesDir: string = SLICES_DIR): readonly LaunchSlice[] {
  let entries: readonly string[];
  try {
    entries = readdirSync(slicesDir);
  } catch {
    return [];
  }
  const sorted = [...entries].sort((a, b) => a.localeCompare(b));
  const unreadable = sorted.filter((name) => !name.endsWith('.md'));
  if (unreadable.length > 0) {
    throw new SliceParseError(
      relative(REPO_ROOT, slicesDir),
      `holds ${unreadable.map((name) => `"${name}"`).join(', ')}, which the reconciler cannot read. ` +
        'A slice record must be Markdown named <slice-id>.md — see docs/engineering/launch/README.md ' +
        '§ "The slice-file contract". Convert it or move it out of this directory.',
    );
  }
  return sorted.map((name) => {
    const absolute = join(slicesDir, name);
    return parseSlice(readFileSync(absolute, 'utf8'), relative(REPO_ROOT, absolute));
  });
}

/** Rank of an outcome from weakest to strongest, used to resolve a split claim. */
const OUTCOME_STRENGTH: Readonly<Record<LaunchOutcome, number>> = {
  'not-built': 0,
  fail: 1,
  unverifiable: 2,
  partial: 3,
  pass: 4,
};

/**
 * Reconcile slice claims against the baseline.
 *
 * @remarks
 * Every baseline id gets a row whether or not a slice claims it — an unclaimed requirement is
 * the failure mode this reconciler exists to make visible, so it must never be omitted from
 * the output. A duplicate claim is always an error, with no exemptions.
 *
 * There used to be one. `DOUBLE_CLAIM_ALLOWLIST` named GEN-06, whose acceptance has two
 * independent clauses, so that `ci-gating` and `test-standards` could each claim the clause they
 * had built. What it actually bought was three slice files claiming GEN-06 with two different
 * outcomes — two `pass`, one `partial` — and a duplicate check that skipped the one id where the
 * duplicate mattered. The weakest-claim rule below still ran and still produced the right number,
 * which is the trap: the record was correct while every slice file a human might open was not.
 * A requirement with two clauses is still one requirement, and one slice grades it.
 *
 * The weakest-claim reduction is kept even though nothing may now claim an id twice. It is the
 * behavior that makes a duplicate *safe while it exists* — a claim can only be removed after it
 * has been written, and during that window the record must not read the more flattering of two
 * grades.
 *
 * @param requirements - The baseline.
 * @param slices - The slice files.
 * @returns the per-requirement reconciliation plus the unclaimed / doubly-claimed / unknown sets.
 */
export function reconcile(
  requirements: readonly LaunchRequirement[],
  slices: readonly LaunchSlice[],
): ReconcileResult {
  const claims = new Map<string, { slices: string[]; outcomes: LaunchOutcome[] }>();
  for (const slice of slices) {
    for (const id of slice.requirementIds) {
      const outcome = slice.outcomes[id];
      if (outcome === undefined) continue; // unreachable: parseSlice guarantees the entry
      const existing = claims.get(id);
      if (existing) {
        existing.slices.push(slice.slice);
        existing.outcomes.push(outcome);
      } else {
        claims.set(id, { slices: [slice.slice], outcomes: [outcome] });
      }
    }
  }

  const baselineIds = new Set(requirements.map((requirement) => requirement.id));
  const rows: ReconciledRequirement[] = [];
  const unclaimed: string[] = [];
  const doublyClaimed: DoubleClaim[] = [];

  for (const requirement of requirements) {
    const claim = claims.get(requirement.id);
    if (!claim) unclaimed.push(requirement.id);
    if (claim && claim.slices.length > 1) {
      doublyClaimed.push({ id: requirement.id, slices: [...claim.slices] });
    }
    const weakestIndex = claim
      ? claim.outcomes.reduce(
          (lowest, outcome, index) =>
            OUTCOME_STRENGTH[outcome] < OUTCOME_STRENGTH[claim.outcomes[lowest] ?? outcome]
              ? index
              : lowest,
          0,
        )
      : -1;
    const weakest = claim ? claim.outcomes[weakestIndex] : undefined;
    rows.push({
      id: requirement.id,
      area: requirement.area,
      severity: requirement.severity,
      baselineStatus: requirement.status,
      claimedBy: claim ? [...claim.slices] : [],
      claimedOutcome: weakest ?? null,
      weakestSlice: claim ? (claim.slices[weakestIndex] ?? null) : null,
    });
  }

  const unknownClaims: UnknownClaim[] = [];
  for (const slice of slices) {
    for (const id of slice.requirementIds) {
      if (!baselineIds.has(id)) unknownClaims.push({ id, slice: slice.slice });
    }
  }

  return {
    rows,
    unclaimed,
    doublyClaimed,
    unknownClaims,
    slices: slices.map((slice) => slice.slice),
  };
}

/** Severity order used when sorting the sign-off report worst-first. */
const SEVERITY_ORDER: Readonly<Record<Severity, number>> = {
  'launch-blocker': 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Tally the requirements standing between the current state and GEN-01 sign-off.
 *
 * @remarks
 * A requirement is **open** when no slice claims it, or when the claim is anything other than
 * `pass`. GEN-01's acceptance names `deferred | partial | TODO | blocked`; this implementation
 * counts a strict superset (every non-`pass` disposition plus unclaimed), because a
 * requirement recorded `fail`, `not-built`, or `unverifiable` is no more shipped than one
 * recorded `partial`. Narrowing this predicate would manufacture a green sign-off, which is
 * exactly the failure GEN-01 exists to prevent.
 *
 * @param result - The reconciliation to tally.
 * @returns the open items, counts by reason, and whether sign-off is clean.
 */
export function signOffReport(result: ReconcileResult): SignOffReport {
  const open: SignOffItem[] = [];
  const byReason: Record<SignOffReason, number> = {
    unclaimed: 0,
    pass: 0,
    partial: 0,
    fail: 0,
    'not-built': 0,
    unverifiable: 0,
  };

  for (const row of result.rows) {
    if (row.claimedOutcome === 'pass') continue;
    const reason: SignOffReason = row.claimedOutcome ?? 'unclaimed';
    byReason[reason] += 1;
    open.push({ id: row.id, severity: row.severity, reason });
  }

  open.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id);
  });

  return {
    total: result.rows.length,
    closed: result.rows.length - open.length,
    open,
    openCount: open.length,
    byReason,
    clean: open.length === 0,
  };
}

/**
 * The record state a claim earns, given whether its slice was independently verified.
 *
 * @remarks
 * This is the single place the launch decides what "done" means, and it is deliberately the only
 * writer of `state`. The record used to hold hand-typed states that a second tool re-derived from
 * the slice files, which is how `GEN-07` and `GEN-23` came to read `pass` in one ledger and
 * `not-started` in the other. Deriving the state makes that disagreement unrepresentable rather
 * than merely detectable.
 *
 * A `pass` that no independent verifier has checked stops at `in-progress`. That is GEN-09's gate
 * expressed as a state transition instead of a lint: the requirement cannot reach `closed` by
 * anyone editing a file, only by a verifier producing an artifact. The gap is counted and printed
 * on every run, so a slice waiting on verification is visible rather than silently equivalent to
 * one nobody has started.
 *
 * @param outcome - The weakest slice claim, or `null` when no slice claims the requirement.
 * @param sliceVerified - Whether the claiming slice's verification holds.
 * @returns The state the record must record.
 */
export function stateForClaim(
  outcome: LaunchOutcome | null,
  sliceVerified: boolean,
): LaunchEntryState {
  if (outcome === null) return 'not-started';
  if (outcome === 'unverifiable') return 'blocked';
  if (outcome === 'pass' && sliceVerified) return 'closed';
  return 'in-progress';
}

/**
 * Project the baseline and the slice files into the launch record.
 *
 * @remarks
 * `owner`, `claim`, `state`, `verifiedBy`, and `verificationArtifacts` are computed here on every
 * run and overwrite whatever the previous record held — they are facts about the slice files, and
 * a copy of a fact that can be edited independently is just a second fact waiting to disagree.
 * `evidence`, `worklogAnchor`, and `blockedReason` are genuinely human-authored and carry across
 * untouched, as do `signOff`, `externalSystems`, and `questions`.
 *
 * @param requirements - The audited baseline, in file order.
 * @param result - The reconciliation of that baseline against the slice files.
 * @param slices - The parsed slice files, for verifier attribution.
 * @param previous - The record currently on disk, or `null` on first generation.
 * @param artifactExists - Whether a repo-root-relative path is present on disk.
 * @returns A record whose entries correspond one-to-one with `requirements`.
 */
export function deriveLaunchRecord(
  requirements: readonly LaunchRequirement[],
  result: ReconcileResult,
  slices: readonly LaunchSlice[],
  previous: LaunchRecord | null,
  artifactExists: (artifact: string) => boolean,
): LaunchRecord {
  // `notes` is optional in the reconciler's view of a requirement and required in the record
  // schema's; normalizing here keeps the two type declarations honest instead of casting past them.
  const base = buildLaunchRecord(
    requirements.map(
      (requirement): ComplianceRequirement => ({
        ...requirement,
        notes: requirement.notes ?? '',
      }),
    ),
    previous,
  );
  const rows = new Map(result.rows.map((row) => [row.id, row]));
  const bySlice = new Map(slices.map((slice) => [slice.slice, slice]));
  const verified = verifiedSlices(slices, artifactExists);

  const entries: LaunchRecordEntry[] = base.entries.map((entry) => {
    const row = rows.get(entry.id);
    const owningSlice = row?.weakestSlice ?? null;
    const slice = owningSlice === null ? undefined : bySlice.get(owningSlice);
    const state = stateForClaim(
      row?.claimedOutcome ?? null,
      owningSlice !== null && verified.has(owningSlice),
    );
    return {
      ...entry,
      owner: owningSlice ?? 'unassigned',
      claim: row?.claimedOutcome ?? '',
      state,
      verifiedBy: slice?.verifier ?? '',
      verificationArtifacts: [...(slice?.verifierArtifacts ?? [])],
      blockedReason: state === 'blocked' ? entry.blockedReason : null,
    };
  });

  return { ...base, entries };
}

/** Structural problems that fail the default CLI mode. */
export interface StructuralProblems {
  /** Ids claimed by two slices without an allowlist entry. */
  readonly doublyClaimed: readonly DoubleClaim[];
  /** Ids claimed by a slice but absent from the baseline. */
  readonly unknownClaims: readonly UnknownClaim[];
  /** True when neither list has entries. */
  readonly ok: boolean;
}

/**
 * Collect the structural problems that must never be present on the launch branch.
 *
 * @remarks
 * Deliberately excludes "unclaimed" — a requirement no slice has reached yet is the normal
 * mid-launch state and is the sign-off gate's business, not the structural gate's.
 *
 * @param result - The reconciliation to inspect.
 * @returns the double claims, unknown claims, and whether the structure is clean.
 */
export function structuralProblems(result: ReconcileResult): StructuralProblems {
  return {
    doublyClaimed: result.doublyClaimed,
    unknownClaims: result.unknownClaims,
    ok: result.doublyClaimed.length === 0 && result.unknownClaims.length === 0,
  };
}

/**
 * Run generated output through the repo's Prettier configuration before it is written.
 *
 * @remarks
 * Both generated files are covered by `pnpm format:check`, so the generator has to agree with
 * Prettier byte-for-byte rather than merely emit valid Markdown and JSON — otherwise every
 * regeneration turns the repo format gate red. Prettier is imported lazily so that importing this
 * module for its pure functions (as the test suite does) costs nothing.
 *
 * @param contents - The rendered, unformatted document.
 * @param filepath - Destination path; Prettier infers parser and config from it.
 * @returns the Prettier-formatted document.
 */
async function formatFor(contents: string, filepath: string): Promise<string> {
  const { format, resolveConfig } = await import('prettier');
  const config = await resolveConfig(filepath);
  return format(contents, { ...config, filepath });
}

/** Read the record currently on disk, if there is one. */
function readPreviousRecord(): LaunchRecord | null {
  if (!existsSync(LAUNCH_RECORD_PATH)) return null;
  return JSON.parse(readFileSync(LAUNCH_RECORD_PATH, 'utf8')) as LaunchRecord;
}

/** Whether a repo-root-relative path is present on disk. */
function artifactOnDisk(artifact: string): boolean {
  return existsSync(resolve(REPO_ROOT, artifact));
}

/**
 * Run the launch-record CLI.
 *
 * @remarks
 * Default mode regenerates the checklist and enforces the structural gate. `--sign-off`
 * additionally enforces GEN-01's zero-open-requirements gate and prints every offending id.
 *
 * @param argv - Command-line arguments after the script name.
 * @returns the process exit code (0 on success).
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const signOff = argv.includes('--sign-off');
  const requirements = loadRequirements();
  const slices = loadSlices();
  const result = reconcile(requirements, slices);
  const report = signOffReport(result);
  const record = deriveLaunchRecord(
    requirements,
    result,
    slices,
    readPreviousRecord(),
    artifactOnDisk,
  );

  if (!signOff) {
    mkdirSync(dirname(LAUNCH_RECORD_PATH), { recursive: true });
    writeFileSync(
      LAUNCH_RECORD_PATH,
      await formatFor(`${JSON.stringify(record, null, 2)}\n`, LAUNCH_RECORD_PATH),
      'utf8',
    );
    writeFileSync(
      LAUNCH_CHECKLIST_PATH,
      await formatFor(renderChecklistMarkdown(record), LAUNCH_CHECKLIST_PATH),
      'utf8',
    );
    console.log(`✓ wrote ${relative(REPO_ROOT, LAUNCH_RECORD_PATH)}`);
    console.log(`✓ wrote ${relative(REPO_ROOT, LAUNCH_CHECKLIST_PATH)}`);
  }

  // One headline, from one record. `closed` counts requirements a verifier confirmed; the
  // awaiting-verification count is the gap that used to hide between two ledgers reporting
  // two different totals, so it is printed rather than left to be discovered by diffing files.
  const closed = record.entries.filter((entry) => entry.state === 'closed').length;
  const awaiting = record.entries.filter(
    (entry) => entry.claim === 'pass' && entry.state !== 'closed',
  ).length;
  console.log(
    `requirements=${String(record.entries.length)} closed=${String(closed)} ` +
      `open=${String(record.entries.length - closed)} ` +
      `awaiting-verification=${String(awaiting)} slices=${String(slices.length)} ` +
      `sign-off=${record.signOff ? 'granted' : 'withheld'} ` +
      `(${String(signOffViolations(record).length)} gate violations)`,
  );

  const structure = structuralProblems(result);
  for (const duplicate of structure.doublyClaimed) {
    console.error(`✗ ${duplicate.id} is claimed by ${duplicate.slices.join(' and ')}`);
  }
  for (const unknown of structure.unknownClaims) {
    console.error(`✗ ${unknown.slice} claims ${unknown.id}, which the baseline does not define`);
  }
  const verification = sliceVerificationProblems(slices, artifactOnDisk);
  for (const problem of verification) console.error(`✗ ${problem}`);
  if (!structure.ok || verification.length > 0) return 1;

  if (!signOff) return 0;

  if (report.clean) {
    console.log('✓ sign-off gate clean: every requirement is closed `pass` by exactly one slice.');
    return 0;
  }
  console.error(`✗ sign-off blocked by ${String(report.openCount)} open requirement(s):`);
  for (const [reason, count] of Object.entries(report.byReason)) {
    if (count > 0) console.error(`  ${reason}: ${String(count)}`);
  }
  for (const item of report.open) {
    console.error(`  ${item.id} [${item.severity}] ${item.reason}`);
  }
  return 1;
}

/* v8 ignore start -- CLI process boundary; the exported functions above carry the coverage. */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
/* v8 ignore stop */
