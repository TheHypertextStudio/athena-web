import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT } from '../workspace';
import {
  ALLOWED_BLOCKER_CAUSES,
  BLOCKER_EXCUSE_PATTERN,
  DEFERRAL_LANGUAGE_PATTERN,
  EXTERNAL_SYSTEMS,
  FORBIDDEN_BLOCKER_CAUSES,
  LAUNCH_CHECKLIST_PATH,
  LAUNCH_CHECKLIST_RELATIVE_PATH,
  LAUNCH_RECORD_RELATIVE_PATH,
  VERIFIER_EVIDENCE_ROOTS,
  blockedEntryViolations,
  loadComplianceRequirements,
  loadLaunchRecord,
  multiClaimViolations,
  namesSameAgent,
  questionViolations,
  renderChecklistMarkdown,
  signOffViolations,
  sliceClaimViolations,
  verificationViolations,
  weakestClaims,
  type LaunchEntryState,
  type LaunchRecord,
  type LaunchRecordEntry,
  type SliceClaim,
} from './launch-record-schema';
import { loadSlices } from '../../../../scripts/launch-record';

/** Whether a workspace-root-relative artifact path is present on disk. */
function onDisk(artifact: string): boolean {
  return existsSync(resolve(WORKSPACE_ROOT, artifact));
}

const ENTRY_STATES = new Set<string>([
  'not-started',
  'in-progress',
  'closed',
  'blocked',
] satisfies LaunchEntryState[]);

const REGENERATE = 'Regenerate with `pnpm exec tsx scripts/launch-record.ts`.';

/** Build a launch-record entry for a fixture, with sensible closed-entry defaults. */
function fixtureEntry(overrides: Partial<LaunchRecordEntry> = {}): LaunchRecordEntry {
  return {
    id: 'GEN-01',
    area: 'Launch Scope',
    severity: 'launch-blocker',
    owner: 'launch-governance',
    // The default entry is `closed`, so its slice claim has to be `pass` — any weaker claim would
    // make the fixture itself violate the ceiling these tests are written to exercise.
    claim: 'pass',
    state: 'closed',
    evidence: 'A sentence long enough to be real evidence of a shipped deliverable.',
    verifiedBy: 'launch-record-reconciler',
    verificationArtifacts: ['docs/engineering/launch/evidence/verification/fixture-run.txt'],
    worklogAnchor: '### [LAUNCH-GOV-001] Launch record and compliance checklist',
    blockedReason: null,
    ...overrides,
  };
}

/** Build a minimal record shell around a fixture's entries. */
function fixtureRecord(overrides: Partial<LaunchRecord> = {}): LaunchRecord {
  return {
    signOff: false,
    generatedFrom: 'docs/engineering/launch-compliance.json',
    externalSystems: [],
    questions: [],
    entries: [fixtureEntry()],
    ...overrides,
  };
}

/**
 * Flatten every committed slice file into one claim per requirement per slice.
 *
 * @remarks
 * Reads through `scripts/launch-record.ts`, the slice reconciler, rather than re-parsing the
 * frontmatter here. Two parsers for one file format is how the launch got two disagreeing records
 * in the first place.
 */
function sliceClaims(): SliceClaim[] {
  return loadSlices().flatMap((slice) =>
    slice.requirementIds.map((requirementId) => ({
      requirementId,
      slice: slice.slice,
      outcome: slice.outcomes[requirementId] ?? 'not-built',
    })),
  );
}

/** Build a record that satisfies the sign-off gate, so the gate can be exercised on fixtures. */
function signOffReadyFixture(overrides: Partial<LaunchRecord> = {}): LaunchRecord {
  return {
    signOff: true,
    generatedFrom: 'docs/engineering/launch-compliance.json',
    externalSystems: EXTERNAL_SYSTEMS.map((system, index) => {
      if (index === 0) {
        return {
          system,
          status: 'authenticated' as const,
          evidence: 'GET /oauth2/v3/userinfo returned 200 for the launch account.',
          workaroundAttempts: [],
        };
      }
      if (index === 1) {
        return {
          system,
          status: 'not-required' as const,
          evidence: 'The launch ships no surface that reads or writes this system.',
          workaroundAttempts: [],
        };
      }
      return {
        system,
        status: 'attempting' as const,
        evidence: '',
        workaroundAttempts: [
          { attempt: 'CLI login', failureOutput: 'error: device code expired' },
          { attempt: 'Headless browser sign-in', failureOutput: 'error: challenge required' },
          { attempt: 'Service-account token exchange', failureOutput: 'error: invalid_grant' },
        ],
      };
    }),
    questions: [],
    entries: [fixtureEntry()],
    ...overrides,
  };
}

/** Describe the first byte at which two strings diverge, or `null` when they are identical. */
function describeDifference(actual: string, expected: string): string | null {
  if (actual === expected) return null;
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  for (let index = 0; index < Math.max(actualLines.length, expectedLines.length); index += 1) {
    if (actualLines[index] !== expectedLines[index]) {
      return [
        `line ${index + 1} differs`,
        `  rendered: ${JSON.stringify(actualLines[index] ?? null)}`,
        `  on disk:  ${JSON.stringify(expectedLines[index] ?? null)}`,
      ].join('\n');
    }
  }
  return `contents differ in length (${actual.length} rendered, ${expected.length} on disk)`;
}

describe('launch record policy', () => {
  const requirements = loadComplianceRequirements();
  const record = loadLaunchRecord();
  const complianceIds = new Set(requirements.map((requirement) => requirement.id));

  it('covers every requirement exactly once', () => {
    const recorded = new Map<string, number>();
    for (const entry of record.entries) {
      recorded.set(entry.id, (recorded.get(entry.id) ?? 0) + 1);
    }
    const missing = [...complianceIds].filter((id) => !recorded.has(id));
    const unknown = [...recorded.keys()].filter((id) => !complianceIds.has(id));
    const duplicated = [...recorded.entries()]
      .filter(([, count]) => count > 1)
      .map(([id, count]) => `${id} appears ${count} times`);

    expect(
      missing,
      `Requirements with no launch-record entry. ${REGENERATE}\n${missing.join('\n')}`,
    ).toEqual([]);
    expect(
      unknown,
      `Launch-record entries the compliance audit does not define. ${REGENERATE}\n${unknown.join('\n')}`,
    ).toEqual([]);
    expect(duplicated, `Duplicated launch-record entries:\n${duplicated.join('\n')}`).toEqual([]);
  });

  it('keeps area and severity in sync with the compliance file', () => {
    const audited = new Map(requirements.map((requirement) => [requirement.id, requirement]));
    const drifted: string[] = [];
    for (const entry of record.entries) {
      const requirement = audited.get(entry.id);
      if (requirement === undefined) continue;
      if (entry.area !== requirement.area) {
        drifted.push(`${entry.id} area "${entry.area}" !== audit "${requirement.area}"`);
      }
      if (entry.severity !== requirement.severity) {
        drifted.push(
          `${entry.id} severity "${entry.severity}" !== audit "${requirement.severity}"`,
        );
      }
    }
    expect(
      drifted,
      `Launch record drifted from the audit. ${REGENERATE}\n${drifted.join('\n')}`,
    ).toEqual([]);
  });

  it('never defers a requirement', () => {
    const violations: string[] = [];
    for (const entry of record.entries) {
      if (!ENTRY_STATES.has(entry.state)) {
        violations.push(`${entry.id} has the unrecognized state "${entry.state}"`);
      }
      if (DEFERRAL_LANGUAGE_PATTERN.test(entry.evidence)) {
        violations.push(`${entry.id} evidence shelves the work: "${entry.evidence}"`);
      }
      const detail = entry.blockedReason?.detail;
      if (detail !== undefined && DEFERRAL_LANGUAGE_PATTERN.test(detail)) {
        violations.push(`${entry.id} blockedReason.detail shelves the work: "${detail}"`);
      }
    }
    expect(
      violations,
      `GEN-01: no requirement may be shelved or shipped halfway.\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('records only permitted blocker causes', () => {
    const blocked = record.entries.filter((entry) => entry.state === 'blocked');
    const forbidden = blocked.filter(
      (entry) =>
        entry.blockedReason !== null &&
        FORBIDDEN_BLOCKER_CAUSES.includes(entry.blockedReason.cause),
    );
    const unreasoned = blocked.filter((entry) => entry.blockedReason === null);
    const disallowed = blocked.filter(
      (entry) =>
        entry.blockedReason !== null && !ALLOWED_BLOCKER_CAUSES.includes(entry.blockedReason.cause),
    );
    const excuses = record.entries.filter(
      (entry) =>
        entry.blockedReason !== null && BLOCKER_EXCUSE_PATTERN.test(entry.blockedReason.detail),
    );

    expect(forbidden.map((entry) => entry.id)).toEqual([]);
    expect(unreasoned.map((entry) => entry.id)).toEqual([]);
    expect(disallowed.map((entry) => entry.id)).toEqual([]);
    expect(excuses.map((entry) => entry.id)).toEqual([]);

    const violations = blockedEntryViolations(record.entries);
    expect(
      violations,
      `GEN-03/GEN-04: an obstacle that is merely hard is not a blocker.\n${violations.join('\n')}`,
    ).toEqual([]);

    // The rule has to bite, not merely be satisfied by an empty blocked set today.
    for (const cause of FORBIDDEN_BLOCKER_CAUSES) {
      const rejected = blockedEntryViolations([
        fixtureEntry({ state: 'blocked', blockedReason: { cause, detail: 'stopped here' } }),
      ]);
      expect(rejected, `"${cause}" must be rejected as a blocker cause`).not.toEqual([]);
    }
    expect(
      blockedEntryViolations([
        fixtureEntry({
          state: 'blocked',
          blockedReason: { cause: 'upstream-outage', detail: "couldn't fetch the spec" },
        }),
      ]),
      'a permitted cause with an access excuse in its detail must still be rejected',
    ).not.toEqual([]);
    expect(
      blockedEntryViolations([
        fixtureEntry({
          state: 'blocked',
          blockedReason: {
            cause: 'awaiting-third-party-review',
            detail: 'App Store review submitted 2026-08-01, decision pending.',
          },
        }),
      ]),
      'a legitimate blocker must be accepted',
    ).toEqual([]);
  });

  it('closed entries carry real evidence verified by someone other than the owner', () => {
    const violations = verificationViolations(record.entries, onDisk);
    expect(
      violations,
      `GEN-09: a closed requirement needs evidence and an independent verifier.\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('refuses a verifier that is the implementer under another name', () => {
    expect(
      verificationViolations([fixtureEntry()], () => true),
      'a properly verified closed entry must be accepted, so the rejections below mean something',
    ).toEqual([]);

    // The exact evasion this repository shipped and the review caught: owner + "-verifier".
    expect(namesSameAgent('launch-governance', 'launch-governance-verifier')).toBe(true);
    expect(namesSameAgent('launch-governance-verifier', 'launch-governance')).toBe(true);
    expect(namesSameAgent('launch-test-governance', 'Launch Test Governance Review')).toBe(true);
    expect(namesSameAgent('launch-test-governance', 'launch-lane-reconciler')).toBe(false);
    expect(namesSameAgent('launch-governance', 'launch-record-reconciler')).toBe(false);

    expect(
      verificationViolations(
        [fixtureEntry({ owner: 'launch-governance', verifiedBy: 'launch-governance-verifier' })],
        () => true,
      ),
      'owner + "-verifier" must be rejected as self-verification',
    ).not.toEqual([]);
    expect(
      verificationViolations([fixtureEntry({ verifiedBy: '' })], () => true),
      'a closed entry with no verifier must be rejected',
    ).not.toEqual([]);
    expect(
      verificationViolations([fixtureEntry({ evidence: 'Shipped.' })], () => true),
      'a closed entry with a one-word evidence sentence must be rejected',
    ).not.toEqual([]);
    expect(
      verificationViolations([fixtureEntry()], () => false),
      'a closed entry citing an artifact that is not on disk must be rejected',
    ).not.toEqual([]);
  });

  it('refuses artifacts the implementer wrote', () => {
    expect(
      verificationViolations(
        [
          fixtureEntry({
            verificationArtifacts: [
              LAUNCH_RECORD_RELATIVE_PATH,
              'packages/test-utils/tests/launch-policies/launch-record.test.ts',
            ],
          }),
        ],
        () => true,
      ),
      'the record and the test that reads it are implementer-authored, not verification',
    ).not.toEqual([]);
    expect(
      verificationViolations(
        [
          fixtureEntry({
            verificationArtifacts: [
              LAUNCH_RECORD_RELATIVE_PATH,
              `${VERIFIER_EVIDENCE_ROOTS[0] ?? ''}verification/run.txt`,
            ],
          }),
        ],
        () => true,
      ),
      'one verifier-produced artifact alongside implementer files must be accepted',
    ).toEqual([]);
  });

  it('records every external system', () => {
    const listed = record.externalSystems.map((system) => system.system);
    expect(listed, 'GEN-05 names exactly these seven systems, in this order').toEqual([
      ...EXTERNAL_SYSTEMS,
    ]);
    expect(new Set(listed).size, 'no external system may appear twice').toBe(listed.length);

    const violations: string[] = [];
    for (const system of record.externalSystems) {
      if (system.status === 'authenticated' && system.evidence.trim() === '') {
        violations.push(`${system.system} claims an authenticated session with no evidence`);
      }
      if (system.status === 'not-required' && system.evidence.trim() === '') {
        violations.push(`${system.system} is marked not-required without saying why`);
      }
    }
    expect(violations, `GEN-05: state the evidence.\n${violations.join('\n')}`).toEqual([]);
  });

  it('justifies every question asked', () => {
    const violations = questionViolations(record.questions, complianceIds);
    expect(
      violations,
      `GEN-08: a question is justified only by two defensible outcomes the plan cannot choose between.\n${violations.join('\n')}`,
    ).toEqual([]);

    const knownId = record.entries[0]?.id ?? 'GEN-01';
    expect(
      questionViolations(
        [
          {
            requirementId: knownId,
            candidateOutcomes: ['ship it as a modal'],
            whyPlanCannotDecide: 'The plan does not say.',
            askedAt: '2026-08-02T00:00:00.000Z',
          },
        ],
        complianceIds,
      ),
      'a question with one candidate outcome and a one-line rationale must be rejected',
    ).not.toEqual([]);
    expect(
      questionViolations(
        [
          {
            requirementId: knownId,
            candidateOutcomes: ['ship it as a modal', 'ship it as a full page'],
            whyPlanCannotDecide:
              'The plan calls the surface "focused" without saying whether focus means a dialog or a route.',
            askedAt: '2026-08-02T00:00:00.000Z',
          },
        ],
        complianceIds,
      ),
      'a fully justified question must be accepted',
    ).toEqual([]);
  });

  it('gates sign-off on a closed record with a working path to every external system', () => {
    expect(typeof record.signOff).toBe('boolean');
    const violations = signOffViolations(record);
    expect(
      record.signOff && violations.length > 0,
      `Sign-off is declared while the gate still reports ${violations.length} violations:\n${violations.slice(0, 20).join('\n')}`,
    ).toBe(false);

    expect(
      signOffViolations(signOffReadyFixture()),
      'a complete record must pass the gate',
    ).toEqual([]);
    expect(
      signOffViolations(
        signOffReadyFixture({
          entries: [fixtureEntry(), fixtureEntry({ id: 'GEN-02', state: 'in-progress' })],
        }),
      ),
      'an open requirement must fail the gate',
    ).not.toEqual([]);
    expect(
      signOffViolations(
        signOffReadyFixture({
          externalSystems: EXTERNAL_SYSTEMS.map((system) => ({
            system,
            status: 'attempting' as const,
            evidence: '',
            workaroundAttempts: [
              { attempt: 'CLI login', failureOutput: 'error: device code expired' },
              { attempt: 'Headless browser sign-in', failureOutput: 'error: challenge required' },
            ],
          })),
        }),
      ),
      'two workaround attempts must fail the gate; GEN-05 asks for three',
    ).not.toEqual([]);
  });

  it('keeps the generated checklist current', () => {
    const rendered = renderChecklistMarkdown(loadLaunchRecord());
    const onDisk = readFileSync(LAUNCH_CHECKLIST_PATH, 'utf8');
    expect(
      describeDifference(rendered, onDisk),
      `${LAUNCH_CHECKLIST_RELATIVE_PATH} is stale. ${REGENERATE}`,
    ).toBeNull();
  });

  it('never claims more than the slice files do', () => {
    const claims = sliceClaims();
    expect(claims.length, 'no slice file was found to reconcile against').toBeGreaterThan(0);

    const violations = sliceClaimViolations(loadLaunchRecord(), claims);
    expect(
      violations,
      [
        `${LAUNCH_RECORD_RELATIVE_PATH} may lag docs/engineering/launch/slices/*.md, never lead them.`,
        'A slice file is where a requirement is claimed; this record is where it is graded, and a',
        'grade may not exceed the claim it is grading.',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('gives every requirement exactly one owning slice', () => {
    const violations = multiClaimViolations(sliceClaims());
    expect(
      violations,
      [
        'A requirement belongs to exactly one slice file. GEN-06 was claimed by three at once —',
        'ci-gating (partial), test-standards (pass), security-and-domains (pass) — and neither',
        'guard could see it: this rule did not exist, and the reconciler allowlisted GEN-06 out of',
        'its own duplicate check. Keep the work in the other slices and leave a "reassigned"',
        'pointer, the way test-standards.md already does for GEN-07.',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('reports a requirement two slices claim, whether or not they agree', () => {
    const conflicting = multiClaimViolations([
      { requirementId: 'GEN-06', slice: 'test-standards', outcome: 'pass' },
      { requirementId: 'GEN-06', slice: 'ci-gating', outcome: 'partial' },
      { requirementId: 'GEN-06', slice: 'security-and-domains', outcome: 'pass' },
    ]);
    expect(conflicting).toHaveLength(1);
    expect(conflicting[0]).toContain('claimed by 3 slices');
    expect(conflicting[0]).toContain('ci-gating (partial)');

    // Agreement is not a defense. Two files that agree today drift the next time one is edited,
    // and the record would then have no way to tell which one to believe.
    expect(
      multiClaimViolations([
        { requirementId: 'SCR-19', slice: 'ci-gating', outcome: 'pass' },
        { requirementId: 'SCR-19', slice: 'test-standards', outcome: 'pass' },
      ]),
      'two slices claiming one id must fail even when their outcomes match',
    ).toHaveLength(1);

    // And the healthy shape produces nothing, so the rule is not simply always red.
    expect(
      multiClaimViolations([
        { requirementId: 'GEN-06', slice: 'ci-gating', outcome: 'partial' },
        { requirementId: 'GEN-07', slice: 'security-and-domains', outcome: 'pass' },
      ]),
    ).toEqual([]);
  });

  it('takes the weakest claim while a duplicate is still being cleaned up', () => {
    // Duplicates are now rejected outright, but a claim can only be removed after it has been
    // written. While both exist the record must read the weaker of them, never the flattering one.
    const claims: SliceClaim[] = [
      { requirementId: 'GEN-06', slice: 'test-standards', outcome: 'pass' },
      { requirementId: 'GEN-06', slice: 'ci-gating', outcome: 'partial' },
    ];
    expect(weakestClaims(claims).get('GEN-06')?.outcome).toBe('partial');
    expect(weakestClaims([...claims].reverse()).get('GEN-06')?.outcome).toBe('partial');
  });

  it('reports a record that claims more than its slice files do', () => {
    const claims: SliceClaim[] = [
      { requirementId: 'GEN-01', slice: 'launch-governance', outcome: 'partial' },
    ];

    // Closed here, only `partial` in the slice: the exact overstatement that shipped once already.
    const overstated = sliceClaimViolations(
      fixtureRecord({ entries: [fixtureEntry({ id: 'GEN-01', state: 'closed' })] }),
      claims,
    );
    expect(overstated.join('\n')).toContain('claims more than launch-governance\'s "partial"');

    // Owner typed by hand instead of taken from the claiming slice.
    const misowned = sliceClaimViolations(
      fixtureRecord({
        entries: [fixtureEntry({ id: 'GEN-01', state: 'in-progress', owner: 'someone-else' })],
      }),
      claims,
    );
    expect(misowned.join('\n')).toContain('claimed by launch-governance');

    // Closed in the record with no slice claiming it at all.
    const unclaimed = sliceClaimViolations(
      fixtureRecord({ entries: [fixtureEntry({ id: 'GEN-01', state: 'closed' })] }),
      [],
    );
    expect(unclaimed.join('\n')).toContain('no slice file claims it');

    // Lagging is explicitly allowed: `pass` may sit at `in-progress` while GEN-09's independent
    // verification is still outstanding. If this ever started failing, the rule would be forcing
    // entries closed before anyone had checked them.
    expect(
      sliceClaimViolations(
        fixtureRecord({ entries: [fixtureEntry({ id: 'GEN-01', state: 'in-progress' })] }),
        [{ requirementId: 'GEN-01', slice: 'launch-governance', outcome: 'pass' }],
      ),
      'a record entry may lag its slice claim while verification is pending',
    ).toEqual([]);

    // And the exactly-matching case produces nothing, so the rule is not simply always red.
    expect(
      sliceClaimViolations(
        fixtureRecord({ entries: [fixtureEntry({ id: 'GEN-01', state: 'in-progress' })] }),
        claims,
      ),
    ).toEqual([]);
  });

  it('reports a record that ignores a slice claim entirely', () => {
    // The failure this closes shipped too, and it is the mirror image of overstatement: GEN-23 sat
    // at `not-started`/`unassigned` here — rendered "Nobody has picked this up" — while
    // `slices/security-and-domains.md` claimed it `pass` and `docs/engineering/domains.md` was on
    // disk. `not-started` is below every ceiling, so the ceiling rule could never see it.
    const claims: SliceClaim[] = [
      { requirementId: 'GEN-23', slice: 'security-and-domains', outcome: 'pass' },
    ];

    const ignored = sliceClaimViolations(
      fixtureRecord({
        entries: [
          fixtureEntry({ id: 'GEN-23', state: 'not-started', owner: 'security-and-domains' }),
        ],
      }),
      claims,
    );
    expect(ignored.join('\n')).toContain('a claimed requirement is at least "in-progress"');

    // The floor holds for a weak claim too — `not-built` still means a worker owns the work.
    const weaklyClaimed = sliceClaimViolations(
      fixtureRecord({
        entries: [
          fixtureEntry({ id: 'GEN-23', state: 'not-started', owner: 'security-and-domains' }),
        ],
      }),
      [{ requirementId: 'GEN-23', slice: 'security-and-domains', outcome: 'not-built' }],
    );
    expect(weaklyClaimed.join('\n')).toContain('a claimed requirement is at least "in-progress"');

    // `unassigned` is no longer an escape from the ownership rule; it was the state GEN-23 used.
    const unowned = sliceClaimViolations(
      fixtureRecord({
        entries: [fixtureEntry({ id: 'GEN-23', state: 'in-progress', owner: 'unassigned' })],
      }),
      claims,
    );
    expect(unowned.join('\n')).toContain('ownership comes from the slice files');

    // A requirement no slice claims may sit at `not-started` forever — that is the honest state of
    // the 366 requirements nobody has started, and the floor must not drag them upward.
    expect(
      sliceClaimViolations(
        fixtureRecord({
          entries: [fixtureEntry({ id: 'GEN-23', state: 'not-started', owner: 'unassigned' })],
        }),
        [],
      ),
      'an unclaimed requirement is legitimately not-started',
    ).toEqual([]);
  });
});
