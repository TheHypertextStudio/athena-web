import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { WORKSPACE_ROOT } from '../workspace';

/**
 * Where the audited requirement list lives, relative to the workspace root.
 *
 * @remarks
 * This file is the single source of requirement ids. It is produced by the compliance audit and
 * is never hand-edited by the launch record or by these tests — the record follows it, not the
 * other way around, so a re-audit can add or re-grade requirements without anyone quietly
 * dropping one from the ledger.
 */
export const COMPLIANCE_RELATIVE_PATH = 'docs/engineering/launch-compliance.json';

/** Where the machine-readable launch record lives, relative to the workspace root. */
export const LAUNCH_RECORD_RELATIVE_PATH = 'docs/engineering/launch/launch-record.json';

/** Where the generated human-readable checklist lives, relative to the workspace root. */
export const LAUNCH_CHECKLIST_RELATIVE_PATH = 'docs/engineering/launch/launch-checklist.md';

/** Absolute path to {@link COMPLIANCE_RELATIVE_PATH}. */
export const COMPLIANCE_PATH = resolve(WORKSPACE_ROOT, COMPLIANCE_RELATIVE_PATH);

/** Absolute path to {@link LAUNCH_RECORD_RELATIVE_PATH}. */
export const LAUNCH_RECORD_PATH = resolve(WORKSPACE_ROOT, LAUNCH_RECORD_RELATIVE_PATH);

/** Absolute path to {@link LAUNCH_CHECKLIST_RELATIVE_PATH}. */
export const LAUNCH_CHECKLIST_PATH = resolve(WORKSPACE_ROOT, LAUNCH_CHECKLIST_RELATIVE_PATH);

/**
 * How far along a single launch requirement is.
 *
 * @remarks
 * Deliberately four values with no "partial", "deferred", or "follow-up" member. GEN-01 forbids
 * shipping a requirement halfway, so the vocabulary itself refuses to express it: work is either
 * untouched, underway, finished, or stopped by a named external cause.
 */
export type LaunchEntryState = 'not-started' | 'in-progress' | 'closed' | 'blocked';

/** An external system the launch has to authenticate against. */
export type ExternalSystem =
  | 'google'
  | 'notion'
  | 'sunsama'
  | 'cloudflare'
  | 'vercel'
  | 'lovelace-lattice'
  | 'twilio';

/**
 * Where an external system stands.
 *
 * @remarks
 * `attempting` is honest but temporary — it is not a valid end state. {@link signOffViolations}
 * rejects it at sign-off unless at least three distinct workarounds were tried and their failure
 * output recorded, which is what GEN-05 asks for.
 */
export type ExternalSystemStatus = 'authenticated' | 'attempting' | 'not-required';

/**
 * The seven external systems named by GEN-05, in the order the launch contract lists them.
 *
 * @remarks
 * Order is fixed so the record's `externalSystems` array is stable across regenerations and
 * diffs stay readable.
 */
export const EXTERNAL_SYSTEMS: readonly ExternalSystem[] = [
  'google',
  'notion',
  'sunsama',
  'cloudflare',
  'vercel',
  'lovelace-lattice',
  'twilio',
];

/**
 * Blocker causes GEN-03 and GEN-04 outlaw outright.
 *
 * @remarks
 * Every one of these describes an obstacle that is merely inconvenient: a doc site that needs a
 * browser, a login prompt, a credential that has to be fetched from somewhere. The launch
 * contract grants full access to the machine, its browsers, its CLIs, and its accounts, so none
 * of them can stop work. Recording one of these as a blocker is the failure, not the obstacle.
 */
export const FORBIDDEN_BLOCKER_CAUSES: readonly string[] = [
  'documentation-unavailable',
  'fetch-failed',
  'paywalled-docs',
  'js-only-docs',
  'missing-permission',
  'missing-access',
  'missing-credentials',
  'could-not-sign-in',
];

/**
 * The only causes a `blocked` entry may carry.
 *
 * @remarks
 * Deliberately narrow, and deliberately limited to things no amount of effort inside this repo
 * can resolve: someone else's service is down, someone else has to review, or the answer only
 * exists in production data that does not exist yet. An obstacle that is merely hard is not a
 * blocker.
 */
export const ALLOWED_BLOCKER_CAUSES: readonly string[] = [
  'upstream-outage',
  'awaiting-third-party-review',
  'requires-production-data',
];

/**
 * Language that means a requirement was shelved rather than finished.
 *
 * @remarks
 * GEN-01 bans partial shipping. The `state` field already refuses to express it, so this catches
 * the other route: prose that quietly admits the work is unfinished while the state says
 * otherwise.
 */
export const DEFERRAL_LANGUAGE_PATTERN =
  /\b(deferred|deferring|follow-?up later|TODO|punt(ed)?)\b/i;

/**
 * Language that means "I was stopped by access, credentials, or an unreachable doc".
 *
 * @remarks
 * The counterpart to {@link FORBIDDEN_BLOCKER_CAUSES}: the slug list catches the structured
 * field, this catches the same excuse written out longhand in the free-text detail.
 */
export const BLOCKER_EXCUSE_PATTERN =
  /\b(no (permission|access|credentials)|could ?n[o']t sign in|paywall|couldn't fetch|fetch failed|docs? (were )?unavailable)\b/i;

/**
 * Directories whose contents only a verification agent writes.
 *
 * @remarks
 * GEN-09 asks for "at least one verification artifact produced by that subagent rather than the
 * implementer". Authorship is not recoverable from a path, so the repository encodes it by
 * convention instead: implementers write source, docs, and the launch record itself; verifiers
 * write captured output — a test log, a screenshot, an HTTP trace — under one of these roots and
 * nowhere else. A closed entry that cites only `launch-record.json` and the policy test that reads
 * it is citing two files its own implementer wrote, which is the exact loophole
 * {@link verificationViolations} closes.
 */
export const VERIFIER_EVIDENCE_ROOTS: readonly string[] = [
  'docs/engineering/launch/evidence/',
  'docs/design/audits/screenshots/',
];

/**
 * The strongest state the record may record for each slice outcome.
 *
 * @remarks
 * The launch carries two records of the same 399 requirements and they must not be able to
 * disagree. `docs/engineering/launch/slices/*.md` is where a worker *claims* a requirement, in the
 * baseline's five-outcome vocabulary; this record is where the launch is *graded*, in a
 * deliberately narrower four-state vocabulary with no "partial" member.
 *
 * The bridge is a **ceiling, not an equality**, and the asymmetry is the whole point. The record
 * may lag a slice — a requirement claimed `pass` sits at `in-progress` until an independent
 * verifier has actually checked it, which is what GEN-09 demands and what
 * {@link verificationViolations} enforces on the way to `closed`. The record may never lead one:
 * closing something a slice itself calls `partial` is the failure this rule exists to stop, and it
 * is the failure that shipped (GEN-09 and MISS-07 both read `closed` here while
 * `slices/launch-governance.md` read `partial` and named what was still missing).
 *
 * `partial` and `fail` share the same ceiling on purpose. GEN-01 forbids shipping a requirement
 * halfway, so neither may reach `closed`. `unverifiable` tops out at `blocked`, which then has to
 * justify itself against {@link ALLOWED_BLOCKER_CAUSES}.
 */
export const MAX_STATE_FOR_SLICE_OUTCOME: Readonly<Record<string, LaunchEntryState>> = {
  pass: 'closed',
  partial: 'in-progress',
  fail: 'in-progress',
  'not-built': 'in-progress',
  unverifiable: 'blocked',
};

/**
 * The weakest state the record may record once any slice has claimed a requirement.
 *
 * @remarks
 * The companion floor to {@link MAX_STATE_FOR_SLICE_OUTCOME}, and the half that was missing. The
 * ceiling stops the record from *overstating* a slice; nothing stopped it from ignoring one
 * entirely, because `not-started` is below every ceiling and so never trips that rule. The gap was
 * live: `GEN-23` read `not-started`/`unassigned` here — which `launch-checklist.md` renders as
 * "Nobody has picked this up" — while `slices/security-and-domains.md` claimed it `pass` and
 * `docs/engineering/domains.md`, the artifact it claims, was on disk. A reader comparing the two
 * ledgers would have found shipped work reported as untouched.
 *
 * `in-progress` is deliberately the floor rather than something stronger. Reaching it asks only
 * that someone admit they are working on the requirement, so this rule can always be satisfied
 * honestly — unlike `closed`, which {@link verificationViolations} rightly gates behind an
 * independent verifier and artifacts that exist. A claim is evidence that work started; it is not
 * evidence that work was checked.
 */
export const MIN_STATE_FOR_CLAIMED_REQUIREMENT: LaunchEntryState = 'in-progress';

/**
 * How much a state claims, for comparison against {@link MAX_STATE_FOR_SLICE_OUTCOME}.
 *
 * @remarks
 * `blocked` sits alongside `in-progress` rather than above it: it asserts that work stopped on a
 * named external cause, not that anything was finished. Only `closed` claims completion.
 */
export const STATE_STRENGTH: Readonly<Record<LaunchEntryState, number>> = {
  'not-started': 0,
  'in-progress': 1,
  blocked: 1,
  closed: 2,
};

/**
 * Slice outcomes ordered from strongest to weakest.
 *
 * @remarks
 * {@link multiClaimViolations} forbids one requirement carrying two claims, so in a healthy tree
 * this ordering has nothing to reduce. It exists for the window in which a duplicate has been
 * written and not yet removed: while two claims coexist the record must reflect the weaker one,
 * because a requirement whose second clause is unproven is not satisfied no matter how firmly the
 * first is. Same rule the slice reconciler applies in `scripts/launch-record.ts`; stated once here
 * so the two cannot diverge.
 */
export const SLICE_OUTCOME_STRENGTH: readonly string[] = [
  'pass',
  'partial',
  'unverifiable',
  'fail',
  'not-built',
];

/** One requirement claimed by one slice file. */
export interface SliceClaim {
  /** The requirement id claimed. */
  readonly requirementId: string;
  /** The claiming slice's id, which is also the owner the record must name. */
  readonly slice: string;
  /** The claim, in the baseline's five-outcome vocabulary. */
  readonly outcome: string;
}

/**
 * Reduce several claims on one requirement to the weakest of them.
 *
 * @remarks
 * Ties keep the first claim in the order given, so the result is stable for a stable input.
 *
 * @param claims - Every claim across every slice file.
 * @returns One weakest claim per requirement id.
 */
export function weakestClaims(claims: readonly SliceClaim[]): Map<string, SliceClaim> {
  const rank = (outcome: string): number => {
    const index = SLICE_OUTCOME_STRENGTH.indexOf(outcome);
    return index === -1 ? SLICE_OUTCOME_STRENGTH.length : index;
  };
  const weakest = new Map<string, SliceClaim>();
  for (const claim of claims) {
    const current = weakest.get(claim.requirementId);
    if (!current || rank(claim.outcome) > rank(current.outcome)) {
      weakest.set(claim.requirementId, claim);
    }
  }
  return weakest;
}

/**
 * Reject any requirement claimed by more than one slice.
 *
 * @remarks
 * The companion to {@link sliceClaimViolations}, and the rule whose absence let a real conflict sit
 * in the tree unreported. GEN-06 was claimed by three slice files at once with two different
 * outcomes — `ci-gating.md` graded it `partial`, `test-standards.md` and `security-and-domains.md`
 * each graded it `pass` — because its acceptance has two clauses and each slice graded the clause
 * it had built. Every file was internally honest and the set was not: a reader who opened either
 * `pass` would have concluded the secret-scan clause was satisfied when it was not.
 *
 * Nothing caught it. {@link sliceClaimViolations} grades the record against the *weakest* claim,
 * so it saw one coherent number and reported nothing. `scripts/launch-record.ts` had a duplicate
 * check, but it carried a `DOUBLE_CLAIM_ALLOWLIST` naming GEN-06 specifically — an exemption for
 * the single id where the duplicate mattered — so the reconciler exited 0 too. Two guards, one
 * blind spot each, aligned.
 *
 * The lesson is why this is a flat rule with no allowlist rather than "duplicates must agree". A
 * requirement with two clauses is still one requirement, and one slice grades it; the other slices
 * keep their work and leave a pointer, the way `test-standards.md` already did for GEN-07. Making
 * agreement sufficient would just move the failure — three files that agree today drift apart the
 * next time one of them is edited.
 *
 * @param claims - Every claim across every slice file.
 * @returns One human-readable line per doubly-claimed requirement; empty when each id has one owner.
 */
export function multiClaimViolations(claims: readonly SliceClaim[]): string[] {
  const bySlice = new Map<string, Map<string, string>>();
  for (const claim of claims) {
    const slices = bySlice.get(claim.requirementId) ?? new Map<string, string>();
    slices.set(claim.slice, claim.outcome);
    bySlice.set(claim.requirementId, slices);
  }

  const violations: string[] = [];
  for (const [requirementId, slices] of bySlice) {
    if (slices.size < 2) continue;
    const rendered = [...slices]
      .map(([slice, outcome]) => `${slice} (${outcome})`)
      .sort((left, right) => left.localeCompare(right));
    violations.push(
      `${requirementId} is claimed by ${String(slices.size)} slices: ${rendered.join(', ')} — a requirement belongs to exactly one slice; leave a "reassigned" pointer in the others`,
    );
  }
  return violations.sort((left, right) => left.localeCompare(right));
}

/**
 * Grade the record against what the slice files actually claim.
 *
 * @remarks
 * The seam this closes is a real one that shipped: the record read `SCR-19: in-progress,
 * unassigned` while `slices/ci-gating.md` read `SCR-19: pass` with a command and its output, and
 * `GEN-09: closed` while `slices/launch-governance.md` said `partial` and named what was missing.
 * Both artifacts were internally consistent; the pair was misleading, and a reader deciding whether
 * to ship would have believed whichever they opened first.
 *
 * Four things are checked. The record's state may not exceed the ceiling
 * {@link MAX_STATE_FOR_SLICE_OUTCOME} puts on the *weakest* claim against that requirement, nor
 * fall below the floor {@link MIN_STATE_FOR_CLAIMED_REQUIREMENT} puts under any claim at all —
 * together those bracket the record to the slice files in both directions, which is what stops the
 * two ledgers from drifting apart while each stays internally consistent. Nothing may be `closed`
 * that no slice claims — a requirement is closed by shipping a slice, not by editing this file.
 * And a claimed entry must name one of its claiming slices as owner, so ownership is derived from
 * the slice files rather than typed twice and left to rot.
 *
 * @param record - The record as committed.
 * @param claims - Every claim across every slice file.
 * @returns One human-readable line per violation; empty when the record does not overstate.
 */
export function sliceClaimViolations(
  record: LaunchRecord,
  claims: readonly SliceClaim[],
): string[] {
  const violations: string[] = [];
  const weakest = weakestClaims(claims);
  const owners = new Map<string, Set<string>>();
  for (const claim of claims) {
    owners.set(
      claim.requirementId,
      (owners.get(claim.requirementId) ?? new Set<string>()).add(claim.slice),
    );
  }

  for (const entry of record.entries) {
    const claim = weakest.get(entry.id);
    if (!claim) {
      if (entry.state === 'closed') {
        violations.push(
          `${entry.id} is closed in the record but no slice file claims it — a requirement is closed by shipping a slice, not by editing the record`,
        );
      }
      continue;
    }
    const ceiling = MAX_STATE_FOR_SLICE_OUTCOME[claim.outcome];
    if (ceiling === undefined) {
      violations.push(
        `${entry.id} is claimed by ${claim.slice} with the unknown outcome "${claim.outcome}"`,
      );
    } else if (STATE_STRENGTH[entry.state] > STATE_STRENGTH[ceiling]) {
      violations.push(
        `${entry.id} is "${entry.state}" in the record, which claims more than ${claim.slice}'s "${claim.outcome}" (ceiling: "${ceiling}")`,
      );
    } else if (STATE_STRENGTH[entry.state] < STATE_STRENGTH[MIN_STATE_FOR_CLAIMED_REQUIREMENT]) {
      violations.push(
        `${entry.id} is "${entry.state}" in the record while ${claim.slice} claims it "${claim.outcome}" — a claimed requirement is at least "${MIN_STATE_FOR_CLAIMED_REQUIREMENT}"`,
      );
    }
    const claimants = owners.get(entry.id) ?? new Set<string>();
    if (entry.owner === 'unassigned') {
      violations.push(
        `${entry.id} is unassigned in the record but claimed by ${[...claimants].join(', ')} — ownership comes from the slice files`,
      );
    } else if (!claimants.has(entry.owner)) {
      violations.push(
        `${entry.id} is owned by "${entry.owner}" in the record but claimed by ${[...claimants].join(', ')}`,
      );
    }
  }
  return violations;
}

/**
 * A requirement as recorded by the compliance audit.
 *
 * @remarks
 * Mirrors `docs/engineering/launch-compliance.json` exactly. Only `id`, `area`, and `severity`
 * flow into the launch record; the rest is context a human reads when picking the work up.
 */
export interface ComplianceRequirement {
  /** Stable requirement id, e.g. `GEN-01`. */
  id: string;
  /** Product area the requirement belongs to. */
  area: string;
  /** What must be true for the requirement to be satisfied. */
  requirement: string;
  /** The sentence in the launch plan this requirement was derived from. */
  sourceQuote: string;
  /** How the auditor proposed to verify it. */
  verifyBy: string;
  /** The literal bar the requirement is graded against. */
  acceptance: string;
  /** Audit severity, e.g. `launch-blocker`. */
  severity: string;
  /** Audit finding at the time of the audit. */
  status: string;
  /** What the auditor observed. */
  evidence: string;
  /** Auditor commentary. */
  notes: string;
}

/** One attempt to get past an external system's authentication, and what it printed. */
export interface WorkaroundAttempt {
  /** What was tried, concretely enough to repeat. */
  attempt: string;
  /** The failure output the attempt produced, verbatim. */
  failureOutput: string;
}

/** Why a requirement is stopped, when — and only when — its state is `blocked`. */
export interface BlockedReason {
  /** One of {@link ALLOWED_BLOCKER_CAUSES}. */
  cause: string;
  /** The specifics: who or what is being waited on, and since when. */
  detail: string;
}

/** How one external system stands, and what was tried if it is not yet authenticated. */
export interface ExternalSystemRecord {
  /** Which system. */
  system: ExternalSystem;
  /** Where it stands. */
  status: ExternalSystemStatus;
  /** The authenticated call or session captured, or why the launch does not touch this system. */
  evidence: string;
  /** Distinct workarounds tried, with their failure output. GEN-05 wants at least three. */
  workaroundAttempts: WorkaroundAttempt[];
}

/**
 * A question that was put to the author instead of being decided autonomously.
 *
 * @remarks
 * GEN-08 does not forbid questions; it forbids unjustified ones. A question is justified only
 * when two or more product outcomes were each defensible and the plan text picks neither — so
 * the record demands exactly that proof, and the policy test fails any question missing it.
 */
export interface LaunchQuestion {
  /** The requirement id the question blocked. */
  requirementId: string;
  /** The two or more outcomes that were each defensible. */
  candidateOutcomes: string[];
  /** Why the plan text could not select between them. */
  whyPlanCannotDecide: string;
  /** ISO-8601 timestamp of when the question was asked. */
  askedAt: string;
}

/** One requirement's disposition in the launch record. */
export interface LaunchRecordEntry {
  /** Requirement id, matching {@link ComplianceRequirement.id}. */
  id: string;
  /** Mirrored from the compliance file on every regeneration. */
  area: string;
  /** Mirrored from the compliance file on every regeneration. */
  severity: string;
  /** Who is doing the work; `unassigned` until someone picks it up. */
  owner: string;
  /**
   * The weakest slice claim against this requirement, in the baseline's five-outcome
   * vocabulary; the empty string when no slice claims it.
   *
   * @remarks
   * This field is what lets one ledger replace two. The launch previously kept the slice claim
   * (`pass` / `partial` / `fail` / `not-built` / `unverifiable`) in a second generated checklist
   * and the graded {@link state} here, and the two were free to answer "how much of the launch is
   * done?" differently — they did, by two requirements, for as long as both existed. Carrying the
   * claim alongside the state in a single record keeps the distinction that made two files
   * tempting (what a worker claims is not the same as what a verifier confirmed) without keeping
   * two files that can drift.
   *
   * Derived on every regeneration from `docs/engineering/launch/slices/*.md`, never hand-written.
   */
  claim: string;
  /** How far along it is. */
  state: LaunchEntryState;
  /** What was shipped, in one factual sentence naming the artifacts. */
  evidence: string;
  /** The agent that independently checked the work. Must differ from {@link owner} (GEN-09). */
  verifiedBy: string;
  /** Paths, relative to the workspace root, that the verifier produced or exercised. */
  verificationArtifacts: string[];
  /** The exact `docs/WORKLOG.md` heading that claims this requirement. */
  worklogAnchor: string;
  /** Populated only when `state` is `blocked`; `null` otherwise. */
  blockedReason: BlockedReason | null;
}

/** The whole launch record. */
export interface LaunchRecord {
  /** Whether launch has been declared. Flipping this to `true` runs the full gate. */
  signOff: boolean;
  /** The compliance file the entries were generated from. */
  generatedFrom: string;
  /** One record per external system named by GEN-05. */
  externalSystems: ExternalSystemRecord[];
  /** Every question put to the author, with its GEN-08 justification. */
  questions: LaunchQuestion[];
  /** One entry per compliance requirement, in compliance-file order. */
  entries: LaunchRecordEntry[];
}

/** Severity rank used to sort the checklist, worst first. */
const SEVERITY_ORDER: readonly string[] = ['launch-blocker', 'high', 'medium', 'low'];

/**
 * How wide the checklist's evidence column may grow.
 *
 * @remarks
 * A Markdown table pads every cell to the widest one in its column, so a single 300-character
 * evidence sentence would pad all 399 rows to 300 characters — a file that is mostly spaces and
 * a diff that rewrites itself whenever any one sentence changes length. The checklist is a
 * rendering; `docs/engineering/launch/launch-record.json` holds the evidence in full.
 */
const MAX_EVIDENCE_CELL_WIDTH = 72;

/** Every state, in the order the checklist summary lists them. */
const ENTRY_STATES: readonly LaunchEntryState[] = [
  'not-started',
  'in-progress',
  'closed',
  'blocked',
];

/**
 * Read and parse the compliance audit.
 *
 * @returns Every audited requirement, in file order.
 */
export function loadComplianceRequirements(): ComplianceRequirement[] {
  return JSON.parse(readFileSync(COMPLIANCE_PATH, 'utf8')) as ComplianceRequirement[];
}

/**
 * Read and parse the launch record.
 *
 * @returns The record as committed.
 * @throws {Error} When the record has not been generated yet — run `scripts/launch-record.ts`.
 */
export function loadLaunchRecord(): LaunchRecord {
  return JSON.parse(readFileSync(LAUNCH_RECORD_PATH, 'utf8')) as LaunchRecord;
}

/**
 * Produce a launch record covering exactly the audited requirements.
 *
 * @remarks
 * Pure and idempotent, which is what makes regeneration safe: `area` and `severity` are always
 * re-read from the compliance file so the record cannot drift away from the audit, while every
 * human-authored field on an existing entry is carried across untouched. Ids the audit dropped
 * disappear; ids it added arrive `unassigned` / `not-started` rather than silently absent.
 *
 * @param requirements - The audited requirements, in compliance-file order.
 * @param previous - The record currently on disk, or `null` on first generation.
 * @returns A record whose entries correspond one-to-one with `requirements`.
 */
export function buildLaunchRecord(
  requirements: ComplianceRequirement[],
  previous: LaunchRecord | null,
): LaunchRecord {
  const existing = new Map<string, LaunchRecordEntry>(
    (previous?.entries ?? []).map((entry) => [entry.id, entry]),
  );
  return {
    signOff: previous?.signOff ?? false,
    generatedFrom: COMPLIANCE_RELATIVE_PATH,
    externalSystems: previous?.externalSystems ?? EXTERNAL_SYSTEMS.map(emptyExternalSystemRecord),
    questions: previous?.questions ?? [],
    entries: requirements.map((requirement) => {
      const carried = existing.get(requirement.id);
      return {
        id: requirement.id,
        area: requirement.area,
        severity: requirement.severity,
        owner: carried?.owner ?? 'unassigned',
        claim: carried?.claim ?? '',
        state: carried?.state ?? 'not-started',
        evidence: carried?.evidence ?? '',
        verifiedBy: carried?.verifiedBy ?? '',
        verificationArtifacts: carried?.verificationArtifacts ?? [],
        worklogAnchor: carried?.worklogAnchor ?? '',
        blockedReason: carried?.blockedReason ?? null,
      };
    }),
  };
}

/**
 * Everything that stands between the record and a defensible launch declaration.
 *
 * @remarks
 * Exported as a plain predicate rather than buried in an assertion so the rule is exercised —
 * and testable against fixtures — long before anyone actually sets `signOff`. A dormant gate
 * that nobody has ever seen return a violation is not a gate.
 *
 * @param record - The record to grade.
 * @returns One human-readable line per violation; empty when the record may be signed off.
 */
export function signOffViolations(record: LaunchRecord): string[] {
  const violations: string[] = [];
  for (const entry of record.entries) {
    if (entry.state !== 'closed') {
      violations.push(`${entry.id} is ${entry.state}, not closed`);
    }
  }
  for (const system of record.externalSystems) {
    if (system.status === 'not-required') continue;
    if (system.status === 'authenticated' && system.evidence.trim() !== '') continue;
    const attempts = system.workaroundAttempts;
    const documented = attempts.filter(
      (attempt) => attempt.attempt.trim() !== '' && attempt.failureOutput.trim() !== '',
    );
    if (documented.length < 3) {
      violations.push(
        `${system.system} is ${system.status} with ${documented.length} documented workaround attempts (need an authenticated session, or 3)`,
      );
    }
  }
  return violations;
}

/**
 * Grade every `blocked` entry against GEN-03 and GEN-04.
 *
 * @remarks
 * Checks the structured cause slug and the free-text detail together, because the same excuse
 * can be written either way and only banning one of them just moves it.
 *
 * @param entries - The record's entries.
 * @returns One human-readable line per violation; empty when every blocker is legitimate.
 */
export function blockedEntryViolations(entries: readonly LaunchRecordEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of entries) {
    const reason = entry.blockedReason;
    if (entry.state !== 'blocked') {
      if (reason !== null) {
        violations.push(`${entry.id} is ${entry.state} but carries a blockedReason`);
      }
      continue;
    }
    if (reason === null) {
      violations.push(`${entry.id} is blocked with no blockedReason`);
      continue;
    }
    if (FORBIDDEN_BLOCKER_CAUSES.includes(reason.cause)) {
      violations.push(`${entry.id} is blocked on the forbidden cause "${reason.cause}"`);
    } else if (!ALLOWED_BLOCKER_CAUSES.includes(reason.cause)) {
      violations.push(`${entry.id} is blocked on the unrecognized cause "${reason.cause}"`);
    }
    if (BLOCKER_EXCUSE_PATTERN.test(reason.detail)) {
      violations.push(
        `${entry.id} blockedReason.detail states an access excuse: "${reason.detail}"`,
      );
    }
  }
  return violations;
}

/**
 * Reduce an agent name to the identity it actually denotes.
 *
 * @remarks
 * Case and separators carry no meaning in these names, and neither does the `-verifier` /
 * `-verification` / `-reviewer` suffix a self-verifying implementer reaches for first. Stripping
 * all three is what lets {@link verificationViolations} see `launch-governance` and
 * `launch-governance-verifier` as one agent wearing two hats.
 *
 * @param name - The `owner` or `verifiedBy` string as written in the record.
 * @returns The normalized identity, lowercased and stripped of separators and role suffixes.
 */
function normalizeAgentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_\s]*(?:verifier|verification|verify|reviewer|review|checker)$/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Whether two agent names denote the same agent.
 *
 * @remarks
 * Containment rather than equality, because the evasions run in both directions: an implementer
 * called `launch-governance` can verify itself as `launch-governance-verifier`, and an implementer
 * called `launch-governance-verifier` can verify itself as `launch-governance`. Either way one of
 * the normalized names is a prefix of the other, so containment catches both while still admitting
 * genuinely unrelated names such as `launch-lane-reconciler`.
 *
 * @param owner - The implementing agent.
 * @param verifier - The agent claimed to have checked the work.
 * @returns `true` when the two names cannot be shown to be different agents.
 */
export function namesSameAgent(owner: string, verifier: string): boolean {
  const left = normalizeAgentName(owner);
  const right = normalizeAgentName(verifier);
  if (left === '' || right === '') return false;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Grade every closed entry against GEN-09.
 *
 * @remarks
 * Three things have to hold at once, and each exists because dropping it produced a green record
 * that meant nothing: the entry must carry real evidence, it must name a verifier that is not the
 * implementer under another name ({@link namesSameAgent}), and at least one of its artifacts must
 * be verifier-produced output ({@link VERIFIER_EVIDENCE_ROOTS}) rather than a source file the
 * implementer wrote. Existence is injected so the rule can be proved against fixtures instead of
 * only observed against today's disk.
 *
 * @param entries - The record's entries.
 * @param artifactExists - Whether a workspace-root-relative path is present on disk.
 * @returns One human-readable line per violation; empty when every closed entry is defensible.
 */
export function verificationViolations(
  entries: readonly LaunchRecordEntry[],
  artifactExists: (artifact: string) => boolean,
): string[] {
  const violations: string[] = [];
  for (const entry of entries) {
    if (entry.state !== 'closed') continue;
    if (entry.evidence.trim().length < 40) {
      violations.push(`${entry.id} closed with ${entry.evidence.trim().length} chars of evidence`);
    }
    if (entry.verifiedBy.trim() === '') {
      violations.push(`${entry.id} closed with no verifiedBy`);
    } else if (namesSameAgent(entry.owner, entry.verifiedBy)) {
      violations.push(
        `${entry.id} was verified by its own implementer: owner "${entry.owner}" and verifiedBy "${entry.verifiedBy}" name the same agent`,
      );
    }
    if (entry.verificationArtifacts.length === 0) {
      violations.push(`${entry.id} closed with no verification artifact`);
    }
    for (const artifact of entry.verificationArtifacts) {
      if (!artifactExists(artifact)) {
        violations.push(
          `${entry.id} cites a verification artifact that is not on disk: ${artifact}`,
        );
      }
    }
    const verifierProduced = entry.verificationArtifacts.filter((artifact) =>
      VERIFIER_EVIDENCE_ROOTS.some((root) => artifact.startsWith(root)),
    );
    if (entry.verificationArtifacts.length > 0 && verifierProduced.length === 0) {
      violations.push(
        `${entry.id} cites only implementer-authored artifacts; GEN-09 needs output the verifier produced under one of ${VERIFIER_EVIDENCE_ROOTS.join(', ')}`,
      );
    }
  }
  return violations;
}

/**
 * Grade every recorded question against GEN-08.
 *
 * @param questions - The record's questions.
 * @param knownIds - Every id the compliance audit defines.
 * @returns One human-readable line per violation; empty when every question is justified.
 */
export function questionViolations(
  questions: readonly LaunchQuestion[],
  knownIds: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  for (const [index, question] of questions.entries()) {
    const label = `questions[${index}] (${question.requirementId})`;
    if (!knownIds.has(question.requirementId)) {
      violations.push(`${label} names a requirement id the compliance audit does not define`);
    }
    if (question.candidateOutcomes.length < 2) {
      violations.push(`${label} lists ${question.candidateOutcomes.length} defensible outcomes`);
    }
    if (question.whyPlanCannotDecide.trim().length < 20) {
      violations.push(`${label} does not explain why the plan text cannot decide`);
    }
  }
  return violations;
}

/**
 * Render the human-readable checklist.
 *
 * @remarks
 * The output is Prettier-stable on purpose — cells are padded to the column's widest value the
 * same way Prettier's Markdown printer pads them — so the generated file survives
 * `pnpm format:check` unchanged and the policy test can compare it to disk byte-for-byte. Width
 * is counted in code points, which matches Prettier for the Latin-script text (including the
 * em dashes in several area names) this record carries.
 *
 * @param record - The record to render.
 * @returns The full contents of `docs/engineering/launch/launch-checklist.md`.
 */
export function renderChecklistMarkdown(record: LaunchRecord): string {
  const blockersOpen = record.entries.filter(
    (entry) => entry.severity === 'launch-blocker' && entry.state !== 'closed',
  ).length;
  const summaryRows: string[][] = [['Requirements tracked', String(record.entries.length)]];
  for (const state of ENTRY_STATES) {
    summaryRows.push([
      `State: ${state}`,
      String(countBy(record.entries, (e) => e.state === state)),
    ]);
  }
  for (const severity of severitiesPresent(record.entries)) {
    summaryRows.push([
      `Severity: ${severity}`,
      String(countBy(record.entries, (e) => e.severity === severity)),
    ]);
  }
  summaryRows.push(['Launch-blockers not closed', String(blockersOpen)]);
  summaryRows.push([
    'Claimed `pass`, awaiting independent verification',
    String(countBy(record.entries, (e) => e.claim === 'pass' && e.state !== 'closed')),
  ]);
  summaryRows.push(['Sign-off gate violations', String(signOffViolations(record).length)]);

  const entryRows = [...record.entries]
    .sort(compareEntries)
    .map((entry) => [
      entry.id,
      entry.area,
      entry.severity,
      entry.owner,
      entry.claim.trim() === '' ? '—' : entry.claim,
      entry.state,
      entry.evidence.trim() === ''
        ? '—'
        : truncate(toCell(entry.evidence), MAX_EVIDENCE_CELL_WIDTH),
    ]);

  return [
    '# Docket launch checklist',
    '',
    `<!-- Generated by \`scripts/launch-record.ts\` from \`${record.generatedFrom}\` and \`docs/engineering/launch/slices/*.md\`. Owner, claim, state, and verification are derived from the slice files; edit those and regenerate. Do not edit this file by hand. -->`,
    '',
    `Sign-off: **${record.signOff ? 'granted' : 'withheld'}**`,
    '',
    '## Summary',
    '',
    ...renderTable(['Measure', 'Count'], summaryRows),
    '',
    '## Requirements',
    '',
    ...renderTable(['ID', 'Area', 'Severity', 'Owner', 'Claim', 'State', 'Evidence'], entryRows),
    '',
  ].join('\n');
}

/** Build the placeholder ledger row for a system nobody has attempted yet. */
function emptyExternalSystemRecord(system: ExternalSystem): ExternalSystemRecord {
  return { system, status: 'attempting', evidence: '', workaroundAttempts: [] };
}

/** Count the entries a predicate accepts. */
function countBy(
  entries: readonly LaunchRecordEntry[],
  predicate: (entry: LaunchRecordEntry) => boolean,
): number {
  let total = 0;
  for (const entry of entries) if (predicate(entry)) total += 1;
  return total;
}

/** Every severity the entries use, worst first, with unknown severities sorted after the known. */
function severitiesPresent(entries: readonly LaunchRecordEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.severity))].sort(
    (left, right) => severityRank(left) - severityRank(right) || left.localeCompare(right),
  );
}

/** Rank a severity for sorting; unrecognized severities sort after every known one. */
function severityRank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

/** Sort entries worst severity first, then by requirement id. */
function compareEntries(left: LaunchRecordEntry, right: LaunchRecordEntry): number {
  return (
    severityRank(left.severity) - severityRank(right.severity) || left.id.localeCompare(right.id)
  );
}

/**
 * Collapse a value to one table-safe line: no newlines, no bare pipes, no doubled spaces.
 *
 * @remarks
 * `*` is escaped alongside `|` because Prettier's Markdown printer escapes it inside a table cell
 * and this renderer has to agree with Prettier byte-for-byte — the checklist is both
 * `pnpm format:check`ed and compared to this function's output. Without it, one evidence sentence
 * containing a glob (`ls apps/web/e2e/*.spec.ts`) silently widens the column by one character on
 * disk and the freshness test fails with a diff nobody can read.
 *
 * The escape is idempotent — an already-escaped marker is left as one escape, not two — because
 * {@link renderTable} normalizes every cell again after {@link renderChecklistMarkdown} has already
 * normalized and truncated the evidence column.
 *
 * @param value - The raw cell text.
 * @returns The text as a single Markdown-table-safe line.
 */
function toCell(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\\?([|*])/g, '\\$1')
    .trim();
}

/**
 * Shorten a cell to `width`, ending it with an ellipsis when anything was dropped.
 *
 * @remarks
 * Steps by code point rather than slicing blindly, so a truncation that lands in the middle of a
 * surrogate pair drops the whole character instead of leaving half of one behind.
 */
function truncate(value: string, width: number): string {
  if (cellWidth(value) <= width) return value;
  let kept = '';
  for (const point of Array.from(value)) {
    if (cellWidth(kept) + cellWidth(point) > width - 1) break;
    kept += point;
  }
  return `${kept}…`;
}

/**
 * Display width of a Markdown table cell.
 *
 * @remarks
 * UTF-16 code units, which is what Prettier's Markdown printer measures for the Latin-script text
 * this record carries — including the em dashes in several area names and the ellipsis this file
 * truncates with, all of which Prettier counts as one column wide.
 */
function cellWidth(value: string): number {
  return value.length;
}

/** Render a GitHub-flavored Markdown table padded exactly the way Prettier pads one. */
function renderTable(headers: readonly string[], rows: readonly string[][]): string[] {
  const cells = rows.map((row) => row.map(toCell));
  const widths = headers.map((header, column) =>
    cells.reduce(
      (widest, row) => Math.max(widest, cellWidth(row[column] ?? '')),
      Math.max(3, cellWidth(toCell(header))),
    ),
  );
  const line = (row: readonly string[]): string =>
    `| ${headers.map((_, column) => pad(row[column] ?? '', widths[column] ?? 3)).join(' | ')} |`;
  return [
    line(headers.map(toCell)),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...cells.map(line),
  ];
}

/** Right-pad a cell to a column width. */
function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - cellWidth(value)));
}
