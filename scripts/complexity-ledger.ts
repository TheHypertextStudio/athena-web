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

import { pathToFileURL } from 'node:url';

import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';

const ROOT = resolve(import.meta.dirname, '..');
const LEDGER = resolve(ROOT, 'tooling/eslint-config/complexity-debt.json');

/** Each rule states the measured value in its message; `LintMessage` does not expose it directly. */
const MEASURED = new Map<string, RegExp>([
  ['complexity', /complexity of (\d+)/],
  ['max-depth', /too deeply \((\d+)\)/],
  ['max-params', /parameters \((\d+)\)/],
  ['sonarjs/cognitive-complexity', /Complexity from (\d+) to/],
]);

// `cwd` is load-bearing: Linter relativizes each filePath against it before matching the `files`
// patterns below. Without it, running from anywhere but the repo root silently matches nothing and
// the scan reports a clean tree.
const linter = new Linter({ configType: 'flat', cwd: ROOT });
// The preset's own block, so the rules and their targets are stated once. Only the parser is
// added: in the real config that comes from `baseConfig`, which this deliberately does not load
// (it is type-aware, and none of these four rules needs type information).
// The preset is untyped plain JavaScript. A static import of it is an implicit `any` that the
// repo's `typecheck:repo` rejects, so it is loaded through a computed URL and narrowed once here.
const preset = (await import(
  pathToFileURL(resolve(ROOT, 'tooling/eslint-config/index.js')).href
)) as { complexityConfig: Linter.Config[] };
const presetBlocks = preset.complexityConfig;
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

const worst: Record<string, Record<string, number>> = {};
for (const file of files) {
  const source = readFileSync(resolve(ROOT, file), 'utf8');
  for (const message of linter.verify(source, config, file)) {
    const pattern = message.ruleId === null ? undefined : MEASURED.get(message.ruleId);
    if (pattern === undefined || message.ruleId === null) continue;
    const found = pattern.exec(message.message);
    if (!found?.[1]) throw new Error(`${message.ruleId} reworded its message: ${message.message}`);
    const value = Number(found[1]);
    const entry = (worst[file] ??= {});
    entry[message.ruleId] = Math.max(entry[message.ruleId] ?? 0, value);
  }
}

// Sorted, so a regeneration diffs as the numbers that changed and nothing else.
const sorted: Record<string, Record<string, number>> = {};
let total = 0;
for (const file of Object.keys(worst).sort()) {
  const rules = worst[file] ?? {};
  const entry: Record<string, number> = {};
  for (const rule of Object.keys(rules).sort()) {
    const value = rules[rule];
    if (value !== undefined) entry[rule] = value;
  }
  sorted[file] = entry;
  total += Object.keys(rules).length;
}
writeFileSync(LEDGER, `${JSON.stringify(sorted, null, 2)}\n`);
process.stdout.write(
  `complexity ledger: ${String(Object.keys(sorted).length)} files, ${String(total)} entries\n`,
);
