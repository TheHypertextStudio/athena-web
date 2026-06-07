/**
 * `@docket/authz` — the pure permission engine.
 *
 * @remarks
 * `canActor` resolves a capability against the containment cascade; the visibility
 * helpers and write-guards round out the model. The API layer adapts these into
 * middleware (`org-context`, `capability-guard`). `satisfies`/`Capability` are
 * re-exported from `@docket/types` so consumers have one import.
 */
export { type Capability, CAPABILITY_RANK, satisfies } from '@docket/types';
export { ancestorChain, type ResourceKind, type ResourceRef } from './ancestor-chain';
export { canActor, type ResolveResult } from './can-actor';
export { effectiveVisibility, visibilityGrantsView } from './visibility';
export {
  lastOwnerGuard,
  LastOwnerError,
  noSelfEscalation,
  SelfEscalationError,
} from './write-guards';
