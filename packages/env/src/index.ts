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

// The host contract. Re-exported from the barrel as well as from `@docket/env/hosts` and
// `@docket/env/custom-domain` because tooling (`scripts/domain-check.ts`) imports the barrel to
// avoid pulling in a fail-fast composition, and a feature should never have to know which of the
// two modules a helper lives in.
export type { HostConfig, HostEnvSource, HostRole, HostSource, ResolvedHost } from './hosts';
export {
  apexOf,
  assertHostConfigIsolated,
  browserHostConfig,
  DEFAULT_ADMIN_SUBDOMAIN,
  DEFAULT_API_SUBDOMAIN,
  DEFAULT_BRIEF_SUBDOMAIN,
  DEFAULT_SUPPORT_MAILBOX,
  HOST_ROLES,
  isUnderApex,
  parseHost,
  requireHost,
  requireOrigin,
  requireSupportEmail,
  resolveHost,
  resolveHostConfig,
  WEB_HOST_ROLES,
} from './hosts';
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
