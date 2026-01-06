/**
 * Middleware exports.
 *
 * @packageDocumentation
 */

export { requireAuth, getUserId, type AuthContext } from './auth.js';
export {
  versionMiddleware,
  getApiVersion,
  isVersionAtLeast,
  isVersionSupported,
  API_VERSIONS,
  type ApiVersion,
  type VersionContext,
} from './version.js';
export { rateLimit, endpointRateLimit, rateLimits, type RateLimitConfig } from './rate-limit.js';
export { requestLogger, getRequestId, getRequestLogger } from './request-logger.js';
export { securityHeaders, validateOrigin, type SecurityHeadersConfig } from './security.js';
