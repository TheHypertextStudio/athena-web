/**
 * `@docket/env` — validated, fail-fast environment slices.
 *
 * @remarks
 * Import the per-surface composition you need from its subpath — `@docket/env/api`
 * (server), `@docket/env/web` / `/marketing` / `/admin` (Next.js client). This root
 * barrel deliberately does NOT import a composition (that would trigger fail-fast
 * validation on any import); it only re-exports the var registry + helpers used by
 * tooling (`scripts/env-check.ts`) and app/container composition.
 */
export type { Scope, Slice, Target, VarSpec } from './registry';
export { findVar, VAR_REGISTRY } from './registry';

/** The deploy modes; `local`/`test` force local test doubles in app containers. */
export type AppMode = 'local' | 'test' | 'production';
export { isRealValue, realEnvValue } from './real-value';

export type {
  CustomDomainNormalization,
  CustomDomainRejection,
  DomainDnsRecord,
  DomainVerificationFailure,
  DomainVerificationResult,
  TxtLookup,
} from './custom-domain';
export {
  acceptCustomDomain,
  CUSTOM_DOMAIN_TOKEN_LENGTH,
  CUSTOM_DOMAIN_TXT_LABEL,
  CUSTOM_DOMAIN_TXT_PREFIX,
  CUSTOM_DOMAIN_TXT_TTL_SECONDS,
  domainRoutingRecord,
  domainVerificationRecord,
  generateCustomDomainToken,
  isReservedCustomDomain,
  normalizeCustomDomain,
  verifyCustomDomain,
} from './custom-domain';
