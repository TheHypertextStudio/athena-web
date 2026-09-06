import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * The banned fallback shape: labeling an unnamed cycle by its raw auto-roll `number` instead of
 * its window (`defaultCycleName`, `@docket/work/cycle-contract`). Both the TypeScript template
 * form and the SQL string-concatenation form are covered — the SQL form is invisible to a grep
 * that only looks for backtick templates, and it is exactly the form that hid two of the four
 * real leak points this test was added to catch. See `cycle-display-name.test.ts` for the
 * behavioral pin; this is the static-source companion that stops a fifth site appearing quietly.
 */
const RAW_CYCLE_NUMBER_PATTERNS = [/`Cycle \$\{/, /'Cycle ' \|\|/, /"Cycle " \+/];

/** `.ts`/`.tsx` source files under one `src/` tree, excluding tests and declaration files. */
function sourceFiles(srcDir: string): string[] {
  return readdirSync(srcDir, { recursive: true })
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((entry) => /\.tsx?$/.test(entry) && !entry.endsWith('.d.ts'))
    .filter((entry) => !/(^|\/)(tests|__tests__)\//.test(entry))
    .map((entry) => resolve(srcDir, entry));
}

function allSourceFiles(): string[] {
  const roots = ['apps/admin', 'apps/api', 'apps/docs', 'apps/runner', 'apps/web'].flatMap(
    (app) => {
      const srcDir = resolve(ROOT, app, 'src');
      try {
        return sourceFiles(srcDir);
      } catch {
        return [];
      }
    },
  );
  const domainRoots = [
    'domains/athena',
    'domains/automation',
    'domains/billing',
    'domains/connections',
    'domains/identity-access',
    'domains/notifications',
    'domains/planning',
    'domains/work',
  ].flatMap((domain) => {
    const srcDir = resolve(ROOT, domain, 'src');
    try {
      return sourceFiles(srcDir);
    } catch {
      return [];
    }
  });
  return [...roots, ...domainRoots];
}

describe('cycle auto-roll number never becomes a label', () => {
  it('has no product source labeling a cycle by its raw auto-roll number', () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles()) {
      const source = readFileSync(file, 'utf8');
      if (RAW_CYCLE_NUMBER_PATTERNS.some((pattern) => pattern.test(source))) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(
      offenders,
      "A cycle's internal auto-roll `number` is an idempotency key, not a label — use " +
        '`defaultCycleName` (`@docket/work/cycle-contract`) or its SQL transliteration ' +
        '`cycleDisplayNameSql` (`apps/api/src/lib/work-views/cycle-label-sql.ts`) instead. See ' +
        'apps/api/tests/routes/cycle-display-name.test.ts for the history of this bug.',
    ).toEqual([]);
  });
});
