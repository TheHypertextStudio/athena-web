/** Privacy-safe, bounded receipts for app-wide interaction responsiveness. */
export {
  MAX_COMPLETED_RECEIPTS,
  MAX_LIVE_RECEIPTS,
  createInteractionReceiptStore,
} from './receipt-store';
export type { InteractionReceiptStore, InteractionReceiptStoreOptions } from './receipt-store';
export type {
  InteractionCategory,
  InteractionId,
  InteractionInvocation,
  InteractionLeakFailure,
  InteractionOutcome,
  InteractionPhase,
  InteractionReceipt,
  InteractionReceiptSnapshot,
  InteractionRecovery,
  RouteTemplateId,
} from './types';
