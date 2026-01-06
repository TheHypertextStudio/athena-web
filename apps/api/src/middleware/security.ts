/**
 * Security middleware for HTTP security headers.
 *
 * Implements OWASP recommended security headers.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { env } from '../lib/env.js';

/**
 * Security headers configuration.
 */
export interface SecurityHeadersConfig {
  /** Content Security Policy directives */
  contentSecurityPolicy?: string | false;
  /** X-Frame-Options value */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** X-Content-Type-Options */
  noSniff?: boolean;
  /** X-XSS-Protection (legacy but still useful for older browsers) */
  xssProtection?: boolean;
  /** Referrer-Policy value */
  referrerPolicy?: string | false;
  /** Strict-Transport-Security config */
  hsts?:
    | {
        maxAge: number;
        includeSubDomains?: boolean;
        preload?: boolean;
      }
    | false;
  /** Permissions-Policy */
  permissionsPolicy?: string | false;
  /** Cross-Origin-Opener-Policy */
  crossOriginOpenerPolicy?: 'same-origin' | 'same-origin-allow-popups' | 'unsafe-none' | false;
  /** Cross-Origin-Resource-Policy */
  crossOriginResourcePolicy?: 'same-origin' | 'same-site' | 'cross-origin' | false;
}

/**
 * Default security configuration.
 */
const defaultConfig: SecurityHeadersConfig = {
  contentSecurityPolicy: [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  frameOptions: 'DENY',
  noSniff: true,
  xssProtection: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  permissionsPolicy: ['camera=()', 'microphone=()', 'geolocation=()', 'interest-cohort=()'].join(
    ', ',
  ),
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
};

/**
 * API-specific configuration (more relaxed for API responses).
 */
const apiConfig: SecurityHeadersConfig = {
  contentSecurityPolicy: false, // APIs typically don't need CSP
  frameOptions: 'DENY',
  noSniff: true,
  xssProtection: false, // Not relevant for JSON APIs
  referrerPolicy: 'no-referrer',
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  permissionsPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: 'cross-origin', // Allow cross-origin API access
};

/**
 * Create security headers middleware.
 *
 * @example
 * ```ts
 * // Use default config
 * app.use(securityHeaders());
 *
 * // Use API-specific config
 * app.use('/api/*', securityHeaders('api'));
 *
 * // Custom config
 * app.use(securityHeaders({ frameOptions: 'SAMEORIGIN' }));
 * ```
 */
export function securityHeaders(configOrPreset: SecurityHeadersConfig | 'default' | 'api' = 'api') {
  let config: SecurityHeadersConfig;

  if (configOrPreset === 'default') {
    config = defaultConfig;
  } else if (configOrPreset === 'api') {
    config = apiConfig;
  } else {
    config = { ...apiConfig, ...configOrPreset };
  }

  return async function securityHeadersMiddleware(c: Context, next: Next): Promise<void> {
    // Content-Security-Policy
    if (config.contentSecurityPolicy) {
      c.header('Content-Security-Policy', config.contentSecurityPolicy);
    }

    // X-Frame-Options
    if (config.frameOptions) {
      c.header('X-Frame-Options', config.frameOptions);
    }

    // X-Content-Type-Options
    if (config.noSniff) {
      c.header('X-Content-Type-Options', 'nosniff');
    }

    // X-XSS-Protection (legacy)
    if (config.xssProtection) {
      c.header('X-XSS-Protection', '1; mode=block');
    }

    // Referrer-Policy
    if (config.referrerPolicy) {
      c.header('Referrer-Policy', config.referrerPolicy);
    }

    // Strict-Transport-Security (only in production with HTTPS)
    if (config.hsts && env.NODE_ENV === 'production') {
      let hstsValue = `max-age=${String(config.hsts.maxAge)}`;
      if (config.hsts.includeSubDomains) {
        hstsValue += '; includeSubDomains';
      }
      if (config.hsts.preload) {
        hstsValue += '; preload';
      }
      c.header('Strict-Transport-Security', hstsValue);
    }

    // Permissions-Policy
    if (config.permissionsPolicy) {
      c.header('Permissions-Policy', config.permissionsPolicy);
    }

    // Cross-Origin-Opener-Policy
    if (config.crossOriginOpenerPolicy) {
      c.header('Cross-Origin-Opener-Policy', config.crossOriginOpenerPolicy);
    }

    // Cross-Origin-Resource-Policy
    if (config.crossOriginResourcePolicy) {
      c.header('Cross-Origin-Resource-Policy', config.crossOriginResourcePolicy);
    }

    // Remove potentially sensitive headers
    c.header('X-Powered-By', ''); // Clear if set by other middleware

    await next();
  };
}

/**
 * Middleware to validate and sanitize the Origin header for CORS.
 * Used in conjunction with Hono's cors middleware.
 */
export function validateOrigin(allowedOrigins: string[]) {
  const originSet = new Set(allowedOrigins.map((o) => o.toLowerCase()));

  return async function validateOriginMiddleware(c: Context, next: Next): Promise<void> {
    const origin = c.req.header('origin');

    if (origin) {
      const normalizedOrigin = origin.toLowerCase();
      if (!originSet.has(normalizedOrigin)) {
        // Log potential CORS attack attempt
        const { logger } = await import('../lib/logger.js');
        logger.warn(
          {
            type: 'security',
            event: 'invalid_origin',
            origin,
            allowedOrigins,
          },
          `Rejected request from invalid origin: ${origin}`,
        );
      }
    }

    await next();
  };
}
