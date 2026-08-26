/** Rollout boundary for the scheduled Stripe reconciliation job. */
import type { BillingGateway } from '@docket/billing/contracts';
import type { BlobStore } from '@docket/blob-store';
import type { Database } from '@docket/db';

import { auditBillingLaunch, type BillingLaunchAuditReport } from './billing-launch-audit';
import { reconcileBilling, type BillingReconciliationResult } from './billing-reconciliation';

/** Scheduled reconciliation behavior selected by deployment configuration. */
export type BillingReconciliationMode = 'off' | 'shadow' | 'active';

/** Configuration for one scheduled billing pass. */
export interface ScheduledBillingReconciliationOptions {
  /** Whether the pass is disabled, read-only, or allowed to repair safe drift. */
  readonly mode: BillingReconciliationMode;
  /** Dashboard attestation included in a shadow launch audit. */
  readonly singleSubscriptionRedirectVerifiedAt?: string;
}

/** A disabled scheduled pass that performed no provider read. */
export interface DisabledBillingReconciliationResult {
  readonly mode: 'off';
  readonly swept: false;
}

/** A read-only scheduled pass that reports drift without repairing it. */
export interface ShadowBillingReconciliationResult {
  readonly mode: 'shadow';
  readonly swept: false;
  readonly audit: BillingLaunchAuditReport;
}

/** A scheduled pass that repaired safe provider mirror drift. */
export interface ActiveBillingReconciliationResult extends BillingReconciliationResult {
  readonly mode: 'active';
  readonly swept: true;
}

/** Result from the configured scheduled reconciliation mode. */
export type ScheduledBillingReconciliationResult =
  | DisabledBillingReconciliationResult
  | ShadowBillingReconciliationResult
  | ActiveBillingReconciliationResult;

/**
 * Run the scheduled billing pass without letting deployment state imply mutation permission.
 *
 * @param database - Docket billing mirror.
 * @param gateway - Stripe provider boundary.
 * @param blob - Private evidence storage used only in active mode.
 * @param now - Stable timestamp for the pass.
 * @param options - Explicit rollout mode and optional Dashboard attestation.
 * @returns A mode-tagged disabled, shadow, or active result.
 */
export async function runScheduledBillingReconciliation(
  database: Database,
  gateway: BillingGateway,
  blob: BlobStore,
  now: Date,
  options: ScheduledBillingReconciliationOptions,
): Promise<ScheduledBillingReconciliationResult> {
  if (options.mode === 'off') return { mode: 'off', swept: false };
  if (options.mode === 'shadow') {
    const audit = await auditBillingLaunch(database, gateway, now, {
      ...(options.singleSubscriptionRedirectVerifiedAt
        ? {
            singleSubscriptionRedirectVerifiedAt: options.singleSubscriptionRedirectVerifiedAt,
          }
        : {}),
    });
    return { mode: 'shadow', swept: false, audit };
  }
  const result = await reconcileBilling(database, gateway, blob, now);
  return { mode: 'active', swept: true, ...result };
}
