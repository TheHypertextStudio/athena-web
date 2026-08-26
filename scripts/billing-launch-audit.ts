/** Run the read-only database and Stripe billing enablement audit. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { closeDb, db } from '../packages/db/src/index';

import { buildStripeBillingGateway, toAppRuntimeEnv } from '../apps/api/src/container';
import { auditBillingLaunch } from '../apps/api/src/services/billing-launch-audit';

function outputPath(argv: readonly string[]): string | null {
  const index = argv.indexOf('--out');
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value) throw new Error('--out requires a file path.');
  return resolve(value);
}

async function main(): Promise<number> {
  // This command must use Stripe while public Checkout remains disabled. The feature flag gates
  // customer mutations, not the release owner's read-only provider audit.
  const report = await auditBillingLaunch(
    db,
    buildStripeBillingGateway(toAppRuntimeEnv()),
    new Date(),
  );
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const target = outputPath(process.argv.slice(2));
  if (target) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, json, { encoding: 'utf8', mode: 0o600 });
    console.error(`Billing launch audit written to ${target}`);
  } else {
    process.stdout.write(json);
  }
  return report.passed ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Billing launch audit failed.');
} finally {
  await closeDb();
}
process.exitCode = exitCode;
