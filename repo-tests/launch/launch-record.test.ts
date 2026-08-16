import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  deriveLaunchRecord,
  loadRequirements,
  loadSlices,
  parseSlice,
  reconcile,
  signOffReport,
  SliceParseError,
  sliceVerificationProblems,
  stateForClaim,
  structuralProblems,
  verifiedSlices,
  type LaunchRequirement,
  type LaunchSlice,
} from '../../scripts/launch-record';
import {
  LAUNCH_CHECKLIST_PATH,
  renderChecklistMarkdown,
} from '../../packages/test-utils/tests/launch-policies/launch-record-schema';

/** Build a minimal baseline requirement for the synthetic-fixture tests. */
function requirement(id: string, overrides: Partial<LaunchRequirement> = {}): LaunchRequirement {
  return {
    id,
    area: 'Launch Scope',
    requirement: `requirement ${id}`,
    sourceQuote: 'quote',
    verifyBy: 'doc-exists',
    acceptance: 'acceptance',
    severity: 'high',
    status: 'not-built',
    evidence: 'evidence',
    ...overrides,
  };
}

/** Build a slice claim without going through the file parser. */
function slice(
  id: string,
  outcomes: Readonly<Record<string, LaunchSlice['outcomes'][string]>>,
): LaunchSlice {
  return {
    slice: id,
    branch: 'claude/docket-production-launch-ebe2d9',
    requirementIds: Object.keys(outcomes),
    outcomes,
    filesChanged: [`docs/engineering/launch/slices/${id}.md`],
    verification: 'pnpm exec vitest run repo-tests/launch',
    verifier: `${id}-independent-checker`,
    verifierArtifacts: [`docs/engineering/launch/evidence/verification/${id}.txt`],
    sourcePath: `docs/engineering/launch/slices/${id}.md`,
  };
}

/** Write a slice file into a throwaway directory and return the directory. */
function sliceDir(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'docket-launch-slices-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, 'utf8');
  return dir;
}

const WELL_FORMED_SLICE = `---
slice: example
branch: claude/docket-production-launch-ebe2d9
requirementIds: [GEN-01, GEN-02]
outcomes:
  GEN-01: pass
  GEN-02: partial
filesChanged:
  - scripts/launch-record.ts
verification: 'pnpm exec vitest run repo-tests/launch — 12 passed'
verifier: launch-record-reconciler
verifierArtifacts:
  - docs/engineering/launch/evidence/verification/2026-08-02-launch-record-reconciliation.txt
---

## GEN-01 — body
`;

describe('slice frontmatter parsing', () => {
  it('reads the full slice contract off a well-formed file', () => {
    const parsed = parseSlice(WELL_FORMED_SLICE, 'slices/example.md');

    expect(parsed.slice).toBe('example');
    expect(parsed.branch).toBe('claude/docket-production-launch-ebe2d9');
    expect(parsed.requirementIds).toEqual(['GEN-01', 'GEN-02']);
    expect(parsed.outcomes).toEqual({ 'GEN-01': 'pass', 'GEN-02': 'partial' });
    expect(parsed.filesChanged).toEqual(['scripts/launch-record.ts']);
    expect(parsed.verification).toBe('pnpm exec vitest run repo-tests/launch — 12 passed');
  });

  it('rejects a slice file with no requirementIds key', () => {
    // Everything the parser requires *except* `requirementIds`, so the throw isolates that key
    // rather than tripping over whichever required field the parser happens to check first.
    const text = `---
slice: example
branch: b
outcomes:
  GEN-01: pass
filesChanged:
  - a.ts
verification: 'ran'
verifier: independent-agent
verifierArtifacts:
  - docs/engineering/launch/evidence/verification/example.txt
---
`;

    expect(() => parseSlice(text, 'slices/example.md')).toThrow(SliceParseError);
    expect(() => parseSlice(text, 'slices/example.md')).toThrow(/requirementIds/);
  });

  it('rejects a claimed id that has no outcomes entry', () => {
    const text = WELL_FORMED_SLICE.replace('  GEN-02: partial\n', '');

    expect(() => parseSlice(text, 'slices/example.md')).toThrow(
      /GEN-02.*no `outcomes` entry|`GEN-02` is claimed/,
    );
  });

  it('rejects an outcomes entry for an id the slice never claimed', () => {
    const text = WELL_FORMED_SLICE.replace(
      '  GEN-02: partial\n',
      '  GEN-02: partial\n  GEN-99: pass\n',
    );

    expect(() => parseSlice(text, 'slices/example.md')).toThrow(/GEN-99/);
  });

  it('rejects an outcome value outside the five allowed dispositions', () => {
    const text = WELL_FORMED_SLICE.replace('GEN-02: partial', 'GEN-02: deferred');

    expect(() => parseSlice(text, 'slices/example.md')).toThrow(/deferred/);
  });

  it('names the offending file in the error so a failing gate is actionable', () => {
    const text = WELL_FORMED_SLICE.replace('verification:', 'notverification:');

    expect(() => parseSlice(text, 'docs/engineering/launch/slices/broken.md')).toThrow(
      /docs\/engineering\/launch\/slices\/broken\.md/,
    );
  });

  it('loads every slice file in a directory in deterministic filename order', () => {
    const dir = sliceDir({
      'zeta.md': WELL_FORMED_SLICE.replace('slice: example', 'slice: zeta')
        .replace('requirementIds: [GEN-01, GEN-02]', 'requirementIds: [GEN-03]')
        .replace('  GEN-01: pass\n', '  GEN-03: pass\n')
        .replace('  GEN-02: partial\n', ''),
      'alpha.md': WELL_FORMED_SLICE.replace('slice: example', 'slice: alpha'),
    });

    expect(loadSlices(dir).map((entry) => entry.slice)).toEqual(['alpha', 'zeta']);
  });

  it('refuses a slice record it cannot read instead of skipping it', () => {
    // This is the failure that shipped: `security-and-domains` filed its record as JSON, the old
    // `.endsWith('.md')` filter dropped it without a word, and the slice was missing from the
    // checklist while its author had every reason to think it was filed. A skip is indistinguishable
    // from an empty directory; a throw names the file.
    const dir = sliceDir({
      'alpha.md': WELL_FORMED_SLICE.replace('slice: example', 'slice: alpha'),
      'beta.json': '{"slice":"beta"}',
    });

    expect(() => loadSlices(dir)).toThrow(SliceParseError);
    expect(() => loadSlices(dir)).toThrow(/"beta\.json"/);
  });
});

describe('reconciliation', () => {
  it('reports an id no slice claims', () => {
    const result = reconcile(
      [requirement('GEN-01'), requirement('GEN-02')],
      [slice('a', { 'GEN-01': 'pass' })],
    );

    expect(result.unclaimed).toEqual(['GEN-02']);
    expect(result.rows.find((row) => row.id === 'GEN-02')?.claimedOutcome).toBeNull();
  });

  it('reports an id claimed by two slices as a structural error', () => {
    const result = reconcile(
      [requirement('SCR-19')],
      [slice('a', { 'SCR-19': 'pass' }), slice('b', { 'SCR-19': 'pass' })],
    );

    expect(result.doublyClaimed).toEqual([{ id: 'SCR-19', slices: ['a', 'b'] }]);
    expect(structuralProblems(result).ok).toBe(false);
  });

  it('exempts no id from the duplicate check, GEN-06 least of all', () => {
    // GEN-06 used to be allowlisted here because its acceptance has two clauses and two slices
    // each built one. The exemption is what let three slice files claim it at once with two
    // different outcomes — two `pass` against one `partial` — and nothing report the conflict.
    // A two-clause requirement is still one requirement, so the allowlist is gone entirely.
    const result = reconcile(
      [requirement('GEN-06')],
      [slice('ci-gating', { 'GEN-06': 'partial' }), slice('test-standards', { 'GEN-06': 'pass' })],
    );

    expect(result.doublyClaimed).toEqual([
      { id: 'GEN-06', slices: ['ci-gating', 'test-standards'] },
    ]);
    expect(structuralProblems(result).ok).toBe(false);
  });

  it('takes the weaker outcome while a duplicate claim is still being cleaned up', () => {
    // The duplicate above is an error, but the record still has to render while someone removes
    // the extra claim — and during that window it must not report the more flattering grade.
    const result = reconcile(
      [requirement('GEN-06')],
      [slice('ci-gating', { 'GEN-06': 'partial' }), slice('test-standards', { 'GEN-06': 'pass' })],
    );

    expect(result.rows[0]?.claimedOutcome).toBe('partial');
    expect(result.rows[0]?.weakestSlice).toBe('ci-gating');
  });

  it('reports a slice claim the baseline does not define', () => {
    const result = reconcile([requirement('GEN-01')], [slice('a', { 'GEN-77': 'pass' })]);

    expect(result.unknownClaims).toEqual([{ id: 'GEN-77', slice: 'a' }]);
    expect(structuralProblems(result).ok).toBe(false);
  });
});

describe('sign-off tally', () => {
  it('counts unclaimed and non-pass claims as open, and names them', () => {
    const report = signOffReport(
      reconcile(
        [
          requirement('GEN-01', { severity: 'launch-blocker' }),
          requirement('GEN-02'),
          requirement('GEN-03'),
        ],
        [slice('a', { 'GEN-02': 'pass', 'GEN-03': 'partial' })],
      ),
    );

    expect(report.total).toBe(3);
    expect(report.closed).toBe(1);
    expect(report.open.map((item) => item.id)).toEqual(['GEN-01', 'GEN-03']);
    expect(report.byReason.unclaimed).toBe(1);
    expect(report.byReason.partial).toBe(1);
    expect(report.clean).toBe(false);
  });

  it('is clean only when every requirement is claimed pass', () => {
    const report = signOffReport(
      reconcile([requirement('GEN-01')], [slice('a', { 'GEN-01': 'pass' })]),
    );

    expect(report.openCount).toBe(0);
    expect(report.clean).toBe(true);
  });

  it('orders open items launch-blockers first', () => {
    const report = signOffReport(
      reconcile(
        [
          requirement('MISS-01', { severity: 'medium' }),
          requirement('GEN-18', { severity: 'launch-blocker' }),
          requirement('GEN-05', { severity: 'high' }),
        ],
        [],
      ),
    );

    expect(report.open.map((item) => item.id)).toEqual(['GEN-18', 'GEN-05', 'MISS-01']);
  });
});

describe('checklist rendering', () => {
  /**
   * Render the checklist the way the CLI does: reconcile, derive the record, render it.
   *
   * @remarks
   * The two generators this repo used to carry were collapsed into `scripts/launch-record.ts`,
   * which now derives the record from the slice files and hands it to `renderChecklistMarkdown`.
   * These tests follow that path rather than a rendering helper of their own, so they exercise
   * what `pnpm launch:record` actually writes.
   *
   * @param requirements - Baseline requirements to render.
   * @param slices - Slice files claiming them.
   * @returns The rendered checklist Markdown.
   */
  function renderFor(
    requirements: readonly LaunchRequirement[],
    slices: readonly LaunchSlice[],
  ): string {
    const result = reconcile(requirements, slices);
    return renderChecklistMarkdown(
      deriveLaunchRecord(requirements, result, slices, null, () => true),
    );
  }

  /** Ids of the requirement rows, in the order the checklist lists them. */
  function rowIdsOf(markdown: string): (string | undefined)[] {
    return markdown
      .split('\n')
      .filter((line) => /^\| [A-Z]+-\d+ +\|/.test(line))
      .map((line) => line.split('|')[1]?.trim());
  }

  it('emits exactly one row for every baseline requirement', () => {
    const requirements = loadRequirements();
    const rowIds = rowIdsOf(renderFor(requirements, loadSlices()));

    expect(rowIds).toHaveLength(requirements.length);
    expect(new Set(rowIds).size).toBe(requirements.length);
    for (const entry of requirements) expect(rowIds).toContain(entry.id);
  });

  it('groups by id family in baseline order and ascends numerically within a family', () => {
    const requirements = [
      requirement('GEN-10'),
      requirement('GEN-02'),
      requirement('MISS-07'),
      requirement('GEN-01'),
      requirement('MISS-01'),
    ];

    expect(rowIdsOf(renderFor(requirements, []))).toEqual([
      'GEN-01',
      'GEN-02',
      'GEN-10',
      'MISS-01',
      'MISS-07',
    ]);
  });

  it('marks an unclaimed requirement as such rather than leaving the cell blank', () => {
    // No slice claims GEN-01, so it has no owner, no claim, and no evidence. Every one of those
    // cells has to say so out loud — a blank cell reads as "fine" to someone scanning the table.
    const markdown = renderFor([requirement('GEN-01')], []);

    expect(markdown).toMatch(/\| GEN-01 +\|.*\| unassigned +\| — +\| not-started +\| — +\|/);
  });
});

describe('the real launch record as it stands today', () => {
  it('has no structural errors: no double claim outside GEN-06, no unknown id', () => {
    const result = reconcile(loadRequirements(), loadSlices());
    const problems = structuralProblems(result);

    expect(problems.doublyClaimed).toEqual([]);
    expect(problems.unknownClaims).toEqual([]);
  });

  it('does not yet pass sign-off, and says exactly which requirements are open', () => {
    const requirements = loadRequirements();
    const result = reconcile(requirements, loadSlices());
    const report = signOffReport(result);

    // The honest state of the launch: most requirements are still owned by other lanes.
    // This assertion is a tripwire — if it ever fails, either the launch genuinely finished
    // or the gate was weakened, and both deserve a human looking at the diff.
    expect(report.clean).toBe(false);
    expect(report.openCount).toBeGreaterThan(0);
    expect(report.open.length).toBe(report.openCount);

    // The report must name ids, not just count them, or it cannot be acted on.
    for (const item of report.open) expect(item.id).toMatch(/^[A-Z]+-\d+$/);
    const openIds = new Set(report.open.map((item) => item.id));
    const baselineNonPass = requirements
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.id);
    const claimedPass = new Set(
      result.rows.filter((row) => row.claimedOutcome === 'pass').map((row) => row.id),
    );
    // Every requirement the audit did not mark `pass` is open unless a slice closed it.
    for (const id of baselineNonPass) {
      if (!claimedPass.has(id)) expect(openIds).toContain(id);
    }
  });

  it('keeps the governance slice claiming its nine requirements exactly once', () => {
    const governance = loadSlices().find((entry) => entry.slice === 'launch-governance');

    expect(governance).toBeDefined();
    expect(governance?.requirementIds).toEqual([
      'GEN-01',
      'GEN-03',
      'GEN-04',
      'GEN-05',
      'GEN-08',
      'GEN-09',
      'GEN-18',
      'MISS-01',
      'MISS-07',
    ]);
  });

  it('has a checklist on disk that still names every baseline id and every slice', () => {
    // GEN-01 is graded on the *committed* checklist, not on what the renderer could produce.
    // A stale file is the failure this guards: regenerate with `pnpm exec tsx scripts/launch-record.ts`.
    const onDisk = readFileSync(LAUNCH_CHECKLIST_PATH, 'utf8');
    const requirements = loadRequirements();

    for (const entry of requirements) {
      expect(onDisk, `launch-checklist.md is missing ${entry.id}`).toContain(`| ${entry.id} `);
    }
    for (const slice of loadSlices()) {
      expect(onDisk, `launch-checklist.md never mentions the ${slice.slice} slice`).toContain(
        slice.slice,
      );
    }
  });
});

describe('GEN-09: a requirement closes only on independent verification', () => {
  it('grades a claim by outcome, and holds an unverified pass at in-progress', () => {
    expect(stateForClaim(null, false)).toBe('not-started');
    expect(stateForClaim('pass', true)).toBe('closed');
    // The gate. A slice may claim `pass` all it likes; without a verifier the record must not
    // say the requirement is done. This is the single line that stops the ledger being talked
    // into a green launch by editing a Markdown file.
    expect(stateForClaim('pass', false)).toBe('in-progress');
    for (const outcome of ['partial', 'fail', 'not-built'] as const) {
      expect(stateForClaim(outcome, true)).toBe('in-progress');
    }
    expect(stateForClaim('unverifiable', true)).toBe('blocked');
  });

  it('accepts a slice whose verifier artifact exists under a verifier-owned root', () => {
    expect(sliceVerificationProblems([slice('alpha', { 'GEN-01': 'pass' })], () => true)).toEqual(
      [],
    );
  });

  it('rejects a verifier artifact that is not on disk', () => {
    const problems = sliceVerificationProblems([slice('alpha', { 'GEN-01': 'pass' })], () => false);

    expect(problems.join('\n')).toMatch(/alpha cites a verifier artifact that is not on disk/);
  });

  it('rejects a slice citing only artifacts the implementer wrote', () => {
    // `scripts/` is not a verifier-owned evidence root. A slice that cites its own source as
    // "verification" is the exact loophole GEN-09 exists to close: the artifact is real, it is
    // on disk, and it proves nothing about independence.
    const implementerOnly: LaunchSlice = {
      ...slice('alpha', { 'GEN-01': 'pass' }),
      verifierArtifacts: ['scripts/launch-record.ts'],
    };

    expect(sliceVerificationProblems([implementerOnly], () => true).join('\n')).toMatch(
      /alpha cites no verifier-produced artifact/,
    );
    expect(verifiedSlices([implementerOnly], () => true).has('alpha')).toBe(false);
  });

  it('refuses to close a pass claim whose verifier artifact is missing', () => {
    const requirements = [requirement('GEN-01')];
    const slices = [slice('alpha', { 'GEN-01': 'pass' })];
    const result = reconcile(requirements, slices);

    const withArtifact = deriveLaunchRecord(requirements, result, slices, null, () => true);
    const withoutArtifact = deriveLaunchRecord(requirements, result, slices, null, () => false);

    expect(withArtifact.entries[0]?.state).toBe('closed');
    expect(withoutArtifact.entries[0]?.state).toBe('in-progress');
    // The claim itself is unchanged either way — what a worker claimed and what a verifier
    // confirmed are different facts, and the record now carries both rather than keeping them
    // in two files that could disagree.
    expect(withoutArtifact.entries[0]?.claim).toBe('pass');
  });

  it('rejects a slice file that names itself as its own verifier', () => {
    const text = WELL_FORMED_SLICE.replace(
      'verifier: launch-record-reconciler',
      'verifier: Example_Verifier',
    );

    // `example` vs `Example_Verifier` — different casing, a separator, and the `-verifier`
    // suffix an implementer reaches for first. All three are stripped before comparing.
    expect(() => parseSlice(text, 'slices/example.md')).toThrow(
      /names the same agent as the slice/,
    );
  });

  it('rejects a slice file with no verifier artifacts at all', () => {
    const text = WELL_FORMED_SLICE.replace(
      /verifierArtifacts:\n( {2}- .*\n)+/,
      'verifierArtifacts: []\n',
    );

    expect(() => parseSlice(text, 'slices/example.md')).toThrow(/verifierArtifacts/);
  });

  it('derives owner and verifier from the slice files rather than from the record', () => {
    const requirements = [requirement('GEN-01')];
    const slices = [slice('alpha', { 'GEN-01': 'pass' })];
    const result = reconcile(requirements, slices);

    // A record that disagreed with the slice files is the failure this collapse removes: the
    // stale values below are overwritten, not merged, so the two cannot drift apart again.
    const stale = deriveLaunchRecord(requirements, result, slices, null, () => true);
    const entry = { ...stale.entries[0] };
    const rederived = deriveLaunchRecord(
      requirements,
      result,
      slices,
      {
        ...stale,
        entries: [
          {
            ...entry,
            owner: 'somebody-else',
            state: 'not-started',
            claim: '',
            verifiedBy: 'nobody',
            verificationArtifacts: [],
          },
        ],
      } as never,
      () => true,
    );

    expect(rederived.entries[0]?.owner).toBe('alpha');
    expect(rederived.entries[0]?.state).toBe('closed');
    expect(rederived.entries[0]?.claim).toBe('pass');
    expect(rederived.entries[0]?.verifiedBy).toBe('alpha-independent-checker');
    expect(rederived.entries[0]?.verificationArtifacts).toEqual([
      'docs/engineering/launch/evidence/verification/alpha.txt',
    ]);
  });
});
