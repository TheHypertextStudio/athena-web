/**
 * `pnpm exec tsx scripts/launch-scorecard.ts` — render the human launch scorecard.
 *
 * @remarks
 * `docs/engineering/launch-compliance.md` has always described itself as generated from
 * `docs/engineering/launch-compliance.json`, but until this module existed nothing generated it:
 * the Markdown was written alongside the JSON by hand, and the two could — and did — drift the
 * moment a status changed in one and not the other. A scorecard that claims to be derived while
 * being hand-maintained is worse than one that admits it is hand-maintained, because a reader
 * trusts the derivation.
 *
 * So this is the renderer, and the claim in the footer is now true. The JSON is the only source
 * of truth: statuses, evidence, severities, areas and their order all come from it. Nothing here
 * decides anything about compliance — it counts and formats.
 *
 * The narrative preamble (what the statuses mean, why `unverifiable` is not a quiet approval) is
 * held here as template text rather than in the JSON, because it describes the audit's method
 * rather than any requirement. Every number inside it is interpolated from the data.
 *
 * @see `scripts/launch-record.ts` for the sign-off ledger, which reconciles slice claims against
 * the same baseline. That tool answers "who shipped what"; this one answers "where does the
 * product stand".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file rather than the caller's cwd. */
export const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The audited requirement baseline this scorecard renders. */
export const BASELINE_PATH: string = join(REPO_ROOT, 'docs/engineering/launch-compliance.json');

/** The rendered scorecard. */
export const SCORECARD_PATH: string = join(REPO_ROOT, 'docs/engineering/launch-compliance.md');

/** The five dispositions a requirement can carry. */
export type Outcome = 'pass' | 'partial' | 'fail' | 'not-built' | 'unverifiable';

/** Severity assigned by the audit. */
export type Severity = 'launch-blocker' | 'high' | 'medium';

/** One audited requirement, as stored in the baseline. */
export interface Requirement {
  /** Stable requirement id, e.g. `GEN-01`. */
  readonly id: string;
  /** Product area the requirement belongs to. */
  readonly area: string;
  /** The requirement in plain language. */
  readonly requirement: string;
  /** Severity assigned by the audit. */
  readonly severity: Severity;
  /** The requirement's current disposition. */
  readonly status: Outcome;
  /** What was run, read, measured or looked at to reach {@link status}. */
  readonly evidence: string;
}

/** Outcomes in the order the scorecard reports them: worst remaining work first. */
const OUTCOME_ORDER: readonly Outcome[] = ['not-built', 'fail', 'partial', 'unverifiable', 'pass'];

/** Read and parse the baseline. */
export function readBaseline(path: string = BASELINE_PATH): readonly Requirement[] {
  return JSON.parse(readFileSync(path, 'utf8')) as Requirement[];
}

/**
 * Escape a cell so a pipe or newline in evidence cannot break the table.
 *
 * @param value - Raw text from the baseline.
 * @returns The same text, safe to place inside a Markdown table cell.
 */
export function cell(value: string): string {
  return value
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/** Count requirements by a key. */
function tally<T extends string>(
  rows: readonly Requirement[],
  key: (r: Requirement) => T,
): Map<T, number> {
  const out = new Map<T, number>();
  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? 0) + 1);
  return out;
}

/**
 * One-line census under an area heading, e.g. `6 requirements — 3 pass · 2 partial · 1 fail`.
 *
 * @param rows - The area's requirements.
 * @returns The census sentence.
 */
export function areaCensus(rows: readonly Requirement[]): string {
  const counts = tally(rows, (r) => r.status);
  const parts = OUTCOME_ORDER.filter((o) => counts.get(o)).map((o) => `${counts.get(o)} ${o}`);
  const blockers = rows.filter(
    (r) => r.severity === 'launch-blocker' && r.status !== 'pass',
  ).length;
  const noun = rows.length === 1 ? 'requirement' : 'requirements';
  const tail = blockers > 0 ? ` · ${blockers} launch-blocker outstanding` : '';
  return `${rows.length} ${noun} — ${parts.join(' · ')}${tail}.`;
}

/** Render the full scorecard Markdown. */
export function renderScorecard(rows: readonly Requirement[], today: string): string {
  const counts = tally(rows, (r) => r.status);
  const sev = tally(rows, (r) => r.severity);
  const n = (o: Outcome): number => counts.get(o) ?? 0;
  const blockersOutstanding = rows.filter(
    (r) => r.severity === 'launch-blocker' && r.status !== 'pass',
  );
  const blockerPass = (sev.get('launch-blocker') ?? 0) - blockersOutstanding.length;

  const out: string[] = [];
  out.push('# Docket — Launch Compliance Scorecard');
  out.push('');
  out.push(
    `> **Status**: Re-audited at the launch gate — ${rows.length} of ${rows.length} requirements adjudicated against observed evidence.`,
  );
  out.push(`> **Last Updated**: ${today}`);
  out.push(
    '> **Machine-readable source of truth**: [`launch-compliance.json`](./launch-compliance.json)',
  );
  out.push('');
  out.push(
    "Every requirement below was mechanically derived from the author's production-launch plan — the plan text was decomposed clause by clause, so each row traces back to something the author actually wrote rather than to an interpretation of what he might have meant. Each requirement carries the author's own words in its `sourceQuote` field in the JSON, alongside the `acceptance` criteria that decide whether it is met.",
  );
  out.push('');
  out.push(
    "**Every status here is backed by observed evidence, not by an agent's self-report.** The `evidence` column records what was actually run, read, measured, or looked at — a command and its output, a file and line, a live HTTP response, a screenshot that was opened and inspected. Where a verdict rests on something weaker than the acceptance criteria demand, the evidence says so in its own words. No requirement was marked complete because an implementer said it was.",
  );
  out.push('');
  out.push('**Statuses mean exactly this:**');
  out.push('');
  out.push(
    '| Status         | Meaning                                                                                          |',
  );
  out.push(
    '| -------------- | ------------------------------------------------------------------------------------------------ |',
  );
  out.push(
    '| `pass`         | The acceptance criteria were met and the evidence demonstrates it.                               |',
  );
  out.push(
    '| `partial`      | Real work exists and some clauses hold, but at least one acceptance clause is unmet or unproven. |',
  );
  out.push(
    '| `fail`         | The capability exists in some form and demonstrably does not meet the requirement.               |',
  );
  out.push(
    '| `not-built`    | The capability, artifact, or test the requirement names does not exist at all.                   |',
  );
  out.push(
    '| `unverifiable` | **Could not be determined either way in this environment.**                                      |',
  );
  out.push('');
  out.push(
    `\`unverifiable\` means exactly that and **must never be read as \`pass\`**. It marks requirements where the evidence needed to decide was out of reach — a production instance that could not be signed into, an external account whose credentials this repository does not hold, a surface with no data to render. Each of those ${n('unverifiable')} rows still needs to be settled before launch; none of them is a quiet approval.`,
  );
  out.push('');
  out.push('---');
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| Metric                          |   Count |');
  out.push('| ------------------------------- | ------: |');
  out.push(`| Total requirements              | ${String(rows.length).padStart(7)} |`);
  out.push(`| Pass                            | ${String(n('pass')).padStart(7)} |`);
  out.push(`| Partial                         | ${String(n('partial')).padStart(7)} |`);
  out.push(`| Fail                            | ${String(n('fail')).padStart(7)} |`);
  out.push(`| Not built                       | ${String(n('not-built')).padStart(7)} |`);
  out.push(`| Unverifiable                    | ${String(n('unverifiable')).padStart(7)} |`);
  out.push(
    `| **Launch blockers outstanding** | ${`**${blockersOutstanding.length}**`.padStart(7)} |`,
  );
  out.push('');
  out.push(
    `Severity split across all ${rows.length} requirements: **${sev.get('launch-blocker') ?? 0} launch-blocker**, ${sev.get('high') ?? 0} high, ${sev.get('medium') ?? 0} medium. Of the ${sev.get('launch-blocker') ?? 0} launch-blockers, ${blockersOutstanding.length} are outstanding (anything not \`pass\`) and ${blockerPass} pass.`,
  );
  out.push('');
  out.push('---');
  out.push('');
  out.push(`## Launch blockers (${blockersOutstanding.length} outstanding)`);
  out.push('');
  const blockerCounts = tally(blockersOutstanding, (r) => r.status);
  const blockerParts = OUTCOME_ORDER.filter((o) => o !== 'pass' && blockerCounts.get(o)).map(
    (o) => `\`${o}\` (${blockerCounts.get(o)})`,
  );
  out.push(
    `Every requirement marked \`launch-blocker\` whose status is anything other than \`pass\`. Sorted worst first by remaining work: ${blockerParts.join(', then ')}. Within each group, ordered by ID.`,
  );
  out.push('');
  out.push('| ID | Area | Requirement | Status | Evidence |');
  out.push('| --- | --- | --- | --- | --- |');
  const rank = (o: Outcome): number => OUTCOME_ORDER.indexOf(o);
  for (const r of [...blockersOutstanding].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.id.localeCompare(b.id),
  )) {
    out.push(
      `| \`${r.id}\` | ${cell(r.area)} | ${cell(r.requirement)} | \`${r.status}\` | ${cell(r.evidence)} |`,
    );
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push('## Findings by area');
  out.push('');
  out.push(
    "One section per area, in the order the areas appear in the plan. Each table is `id | requirement | severity | status | evidence`; the author's source quote and the full acceptance criteria for every row live in [`launch-compliance.json`](./launch-compliance.json).",
  );
  out.push('');
  const areas: string[] = [];
  for (const r of rows) if (!areas.includes(r.area)) areas.push(r.area);
  for (const area of areas) {
    const inArea = rows.filter((r) => r.area === area);
    out.push(`### ${area}`);
    out.push('');
    out.push(areaCensus(inArea));
    out.push('');
    out.push('| ID | Requirement | Severity | Status | Evidence |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const r of inArea) {
      out.push(
        `| \`${r.id}\` | ${cell(r.requirement)} | ${r.severity} | \`${r.status}\` | ${cell(r.evidence)} |`,
      );
    }
    out.push('');
  }
  out.push('---');
  out.push('');
  out.push(
    "_This scorecard is generated from `launch-compliance.json` by `scripts/launch-scorecard.ts`. Edit the JSON and re-render rather than editing this document by hand: `pnpm exec tsx scripts/launch-scorecard.ts && pnpm exec prettier --write docs/engineering/launch-compliance.md`. Prettier needs two passes on a table this wide — the first pass sets the column widths and the second settles them — so run it until `pnpm format:check` is clean, or CI's `quality` job will reject the file._",
  );
  out.push('');
  return out.join('\n');
}

/** Entry point. */
function main(): number {
  const rows = readBaseline();
  const now = new Date();
  // Local calendar date: the ledger is read alongside commits made in the author's timezone, and
  // a UTC date rolls a day early for most of them.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  writeFileSync(SCORECARD_PATH, renderScorecard(rows, today), 'utf8');
  const counts = tally(rows, (r) => r.status);
  const blockers = rows.filter(
    (r) => r.severity === 'launch-blocker' && r.status !== 'pass',
  ).length;
  const summary = OUTCOME_ORDER.filter((o) => counts.get(o))
    .map((o) => `${o}=${counts.get(o)}`)
    .join(' ');
  process.stdout.write(
    `launch scorecard: ${rows.length} requirement(s) — ${summary}; ${blockers} launch-blocker(s) outstanding\n`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
