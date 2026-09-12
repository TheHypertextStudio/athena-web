/**
 * Regenerate `tooling/eslint-config/complexity-debt.json`.
 *
 * @remarks
 * The complexity gate is four ESLint rules in the shared preset, enforced by the pre-commit hook
 * (`lint-staged` runs `eslint --max-warnings=0` on staged files) and by `pnpm lint`. Turning them
 * on with no exceptions fails every file that already exceeded them, so this records each such
 * file's current worst value and the preset pins the file to it. New and already-clean files are
 * held to the real target.
 *
 * A ratchet, not a target: the numbers may only ever be lowered. Refactor, re-run
 * `pnpm complexity:ledger`, commit the smaller file. Regenerating can only shrink the ledger in a
 * healthy repo — anything that would raise a number fails `eslint` at the commit that introduces
 * it, before it can reach this script.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';

import { complexityConfig, COMPLEXITY_TARGETS } from '../tooling/eslint-config/index.js';

const ROOT = resolve(import.meta.dirname, '..');
const LEDGER = resolve(ROOT, 'tooling/eslint-config/complexity-debt.json');

/** Each rule states the measured value in its message; `LintMessage` does not expose it directly. */
const MEASURED = new Map<string, RegExp>([
  ['complexity', /complexity of (\d+)/],
  ['max-depth', /too deeply \((\d+)\)/],
  ['max-params', /parameters \((\d+)\)/],
  ['sonarjs/cognitive-complexity', /Complexity from (\d+) to/],
  ['max-lines', /too many lines \((\d+)\)/],
  ['max-lines-per-function', /too many lines \((\d+)\)/],
]);

/**
 * One rule's debt in one file: its worst measured value, and how far the file is over target overall.
 *
 * @remarks
 * `excess` is the sum of `value - target` across every violation, not a count of them. Counting
 * punished the refactor it exists to force: splitting one complexity-18 function into two
 * complexity-13 helpers takes the count from 1 to 2 and would have failed the gate, even though the
 * file plainly got simpler. Summing the overshoot falls (6 to 2) for that split, and still rises the
 * moment a new violation is added or an existing one gets worse.
 */
interface DebtEntry {
  readonly max: number;
  readonly excess: number;
}

/** Reject a ledger whose entries are not the current shape rather than silently passing them. */
function readEntry(value: unknown, file: string, rule: string): DebtEntry {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as DebtEntry).max !== 'number' ||
    typeof (value as DebtEntry).excess !== 'number'
  ) {
    // A bare number here is the pre-`excess` shape. Left unchecked, `allowed.max` is `undefined`,
    // every `>` comparison against it is false, and the gate reports "clean" while enforcing
    // nothing for that file.
    throw new Error(
      `complexity ledger: ${file} ${rule} is not {max, excess}. Run \`pnpm complexity:ledger\`.`,
    );
  }
  return value as DebtEntry;
}

const CHECK = process.argv.includes('--check');

// `cwd` is load-bearing: Linter relativizes each filePath against it before matching the `files`
// patterns below. Without it, running from anywhere but the repo root silently matches nothing and
// the scan reports a clean tree.
const linter = new Linter({ configType: 'flat', cwd: ROOT });
// The preset's own block, so the rules and their targets are stated once. Only the parser is
// added: in the real config that comes from `baseConfig`, which this deliberately does not load
// (it is type-aware, and none of these four rules needs type information).
const presetBlocks = complexityConfig as unknown as Linter.Config[];
const config: Linter.Config[] = presetBlocks.map((block) => ({
  ...block,
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
}));

const files = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.mts', '*.cts'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1 << 28,
})
  .split('\n')
  // existsSync: `git ls-files` reads the index, which can list a file that is deleted on disk
  // but not yet staged as such. That is a normal working state, not a reason to crash.
  .filter((file) => file !== '' && !file.endsWith('.d.ts') && existsSync(resolve(ROOT, file)))
  .sort();

const worst: Record<string, Record<string, DebtEntry>> = {};
for (const file of files) {
  const source = readFileSync(resolve(ROOT, file), 'utf8');
  for (const message of linter.verify(source, config, file)) {
    const pattern = message.ruleId === null ? undefined : MEASURED.get(message.ruleId);
    if (pattern === undefined || message.ruleId === null) continue;
    const found = pattern.exec(message.message);
    if (!found?.[1]) throw new Error(`${message.ruleId} reworded its message: ${message.message}`);
    const value = Number(found[1]);
    const target = COMPLEXITY_TARGETS[message.ruleId as keyof typeof COMPLEXITY_TARGETS];
    const rules = (worst[file] ??= {});
    const previous = rules[message.ruleId];
    rules[message.ruleId] = {
      max: Math.max(previous?.max ?? 0, value),
      excess: (previous?.excess ?? 0) + Math.max(0, value - target),
    };
  }
}

// Sorted, so a regeneration diffs as the numbers that changed and nothing else.
const sorted: Record<string, Record<string, DebtEntry>> = {};
let total = 0;
for (const file of Object.keys(worst).sort()) {
  const rules = worst[file] ?? {};
  const entry: Record<string, DebtEntry> = {};
  for (const rule of Object.keys(rules).sort()) {
    const value = rules[rule];
    if (value !== undefined) entry[rule] = value;
  }
  sorted[file] = entry;
  total += Object.keys(rules).length;
}

if (!CHECK) {
  writeFileSync(LEDGER, `${JSON.stringify(sorted, null, 2)}\n`);
  process.stdout.write(
    `complexity ledger: ${String(Object.keys(sorted).length)} files, ${String(total)} entries\n`,
  );
  process.exit(0);
}

/**
 * Compare a fresh measurement against the committed ledger.
 *
 * @remarks
 * ESLint alone cannot catch growth inside a ledgered file: the relaxation raises the *limit* for the
 * whole file, so a brand-new function at the ledgered ceiling produces no message at all. That is
 * the hole `AGENTS.md` documented and did not close — "a new over-complex function inside an
 * already-ledgered file needs no new entry and so this rule cannot catch it".
 *
 * Two numbers close it, and neither may rise: the worst value, and `excess` — the total overshoot
 * across every violation. Overshoot rather than a count, so that splitting one over-target function
 * into two smaller ones reads as the improvement it is instead of failing the gate for adding a
 * violation.
 */
const committed = JSON.parse(readFileSync(LEDGER, 'utf8')) as Record<
  string,
  Record<string, unknown>
>;
const regressions: string[] = [];
for (const [file, rules] of Object.entries(sorted)) {
  for (const [rule, measured] of Object.entries(rules)) {
    const raw = committed[file]?.[rule];
    if (raw === undefined) {
      regressions.push(`${file}: ${rule} is newly over the target (${String(measured.max)})`);
      continue;
    }
    const allowed = readEntry(raw, file, rule);
    if (measured.max > allowed.max) {
      regressions.push(
        `${file}: ${rule} rose from ${String(allowed.max)} to ${String(measured.max)}`,
      );
    }
    if (measured.excess > allowed.excess) {
      regressions.push(
        `${file}: ${rule} total overshoot grew from ${String(allowed.excess)} to ${String(measured.excess)}`,
      );
    }
  }
}

if (regressions.length > 0) {
  process.stderr.write(
    `complexity ledger: ${String(regressions.length)} regression(s). The ledger may only shrink.\n` +
      `${regressions.map((line) => `  - ${line}`).join('\n')}\n` +
      'Refactor the offending code. Do not regenerate the ledger to absorb it.\n',
  );
  process.exit(1);
}

process.stdout.write(
  `complexity ledger: clean (${String(Object.keys(sorted).length)} files, ${String(total)} entries)\n`,
);
