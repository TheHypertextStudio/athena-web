/**
 * Regenerate `design-token-debt.json` from the current source tree.
 *
 * @remarks
 * Run after migrating files off raw utilities: `pnpm exec tsx tests/design-policies/emit-ledger.ts`
 * from `packages/test-utils`. The ratchet in `design-token-policy.test.ts` only *reads* the ledger;
 * this is how it is written, so the number in the file is always a measurement rather than a guess.
 *
 * Regenerating can only ever shrink the ledger in a healthy repo — if it grows, the run that grew
 * it introduced debt, and the policy test would have failed first.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scanDesignTokenRoots, tallyViolations } from './design-token-scan';
import { WORKSPACE_ROOT } from '../workspace';

const roots = ['apps/web/src', 'apps/admin/src', 'packages/ui/src'].map((root) =>
  resolve(WORKSPACE_ROOT, root),
);
const tally = tallyViolations(scanDesignTokenRoots(roots));
const sorted: Record<string, Record<string, number>> = {};
for (const file of Object.keys(tally).sort()) {
  const rules = tally[file] as Record<string, number>;
  const entry: Record<string, number> = {};
  for (const rule of Object.keys(rules).sort()) entry[rule] = rules[rule] ?? 0;
  sorted[file] = entry;
}
writeFileSync(
  resolve(WORKSPACE_ROOT, 'packages/test-utils/tests/design-policies/design-token-debt.json'),
  `${JSON.stringify(sorted, null, 2)}\n`,
);
process.stdout.write(`design-token debt: ${String(Object.keys(sorted).length)} files\n`);
