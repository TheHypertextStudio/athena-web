/** Verify the deployed billing kill switch, Stripe account, and reconciliation Scheduler. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const RECONCILIATION_INTERVAL_MINUTES = 15;
const MAX_MISSED_RECONCILIATIONS = 2;
const MAX_SCHEDULER_ATTEMPT_AGE_MS =
  RECONCILIATION_INTERVAL_MINUTES * MAX_MISSED_RECONCILIATIONS * 60 * 1000;

/** One normalized observation of the deployed billing runtime. */
export interface BillingRuntimeObservation {
  readonly generatedAt: string;
  readonly revision: string;
  readonly serviceUrl: string;
  readonly checkoutEnabled: boolean;
  readonly reconciliationMode: string;
  readonly expectedReconciliationMode: string;
  readonly stripeAccountId: string;
  readonly expectedStripeAccountId: string;
  readonly scheduler: {
    readonly name: string;
    readonly schedule: string;
    readonly state: string;
    readonly uri: string;
    readonly lastAttemptTime: string | null;
    readonly statusCode: number | null;
  };
}

/** The sanitized rollout evidence stored by the production audit workflow. */
export interface BillingRuntimeRolloutReport {
  readonly generatedAt: string;
  readonly passed: boolean;
  readonly mismatches: readonly string[];
  readonly revision: string;
  readonly serviceUrl: string;
  readonly checkoutEnabled: boolean;
  readonly reconciliationMode: string;
  readonly stripeAccountId: string;
  readonly scheduler: BillingRuntimeObservation['scheduler'];
}

/**
 * Compare one normalized runtime observation with Docket's billing rollout contract.
 *
 * @param observation - Deployed Cloud Run and Cloud Scheduler state.
 * @returns Sanitized evidence plus every failed invariant.
 */
export function evaluateBillingRuntimeRollout(
  observation: BillingRuntimeObservation,
): BillingRuntimeRolloutReport {
  const mismatches: string[] = [];
  if (observation.checkoutEnabled) mismatches.push('checkout_enabled');
  if (observation.reconciliationMode !== observation.expectedReconciliationMode) {
    mismatches.push('reconciliation_mode');
  }
  if (observation.stripeAccountId !== observation.expectedStripeAccountId) {
    mismatches.push('stripe_account');
  }
  if (observation.scheduler.state !== 'ENABLED') mismatches.push('scheduler_state');
  if (observation.scheduler.schedule !== '*/15 * * * *') mismatches.push('scheduler_schedule');
  if (
    observation.scheduler.uri !== `${observation.serviceUrl}/internal/cron/billing-reconciliation`
  ) {
    mismatches.push('scheduler_uri');
  }
  if (observation.scheduler.statusCode !== 0) mismatches.push('scheduler_status');
  if (observation.scheduler.lastAttemptTime === null) {
    mismatches.push('scheduler_never_run');
  } else {
    const generatedAt = Date.parse(observation.generatedAt);
    const lastAttemptAt = Date.parse(observation.scheduler.lastAttemptTime);
    const attemptAge = generatedAt - lastAttemptAt;
    if (
      !Number.isFinite(generatedAt) ||
      !Number.isFinite(lastAttemptAt) ||
      attemptAge < 0 ||
      attemptAge > MAX_SCHEDULER_ATTEMPT_AGE_MS
    ) {
      mismatches.push('scheduler_stale');
    }
  }

  return {
    generatedAt: observation.generatedAt,
    passed: mismatches.length === 0,
    mismatches,
    revision: observation.revision,
    serviceUrl: observation.serviceUrl,
    checkoutEnabled: observation.checkoutEnabled,
    reconciliationMode: observation.reconciliationMode,
    stripeAccountId: observation.stripeAccountId,
    scheduler: observation.scheduler,
  };
}

function argument(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function nullableArgument(argv: readonly string[], name: string): string | null {
  const value = argument(argv, name);
  return value === 'null' ? null : value;
}

function observationFromArgs(argv: readonly string[]): BillingRuntimeObservation {
  const statusCode = nullableArgument(argv, '--scheduler-status-code');
  return {
    generatedAt: argument(argv, '--generated-at'),
    revision: argument(argv, '--revision'),
    serviceUrl: argument(argv, '--service-url'),
    checkoutEnabled: argument(argv, '--checkout-enabled') === 'true',
    reconciliationMode: argument(argv, '--reconciliation-mode'),
    expectedReconciliationMode: argument(argv, '--expected-reconciliation-mode'),
    stripeAccountId: argument(argv, '--stripe-account-id'),
    expectedStripeAccountId: argument(argv, '--expected-stripe-account-id'),
    scheduler: {
      name: argument(argv, '--scheduler-name'),
      schedule: argument(argv, '--scheduler-schedule'),
      state: argument(argv, '--scheduler-state'),
      uri: argument(argv, '--scheduler-uri'),
      lastAttemptTime: nullableArgument(argv, '--scheduler-last-attempt'),
      statusCode: statusCode === null ? null : Number(statusCode),
    },
  };
}

async function runCli(argv: readonly string[]): Promise<number> {
  const report = evaluateBillingRuntimeRollout(observationFromArgs(argv));
  const output = resolve(argument(argv, '--out'));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return report.passed ? 0 : 1;
}

/* v8 ignore start -- The exported evaluator owns behavior; the workflow covers CLI argument wiring. */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
/* v8 ignore stop */
