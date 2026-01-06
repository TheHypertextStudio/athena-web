/**
 * Rate limiting middleware using sliding window algorithm.
 *
 * Supports per-user and per-endpoint rate limits.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Rate limit configuration.
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key generator function - defaults to IP-based */
  keyGenerator?: (c: Context) => string;
  /** Skip rate limiting for certain requests */
  skip?: (c: Context) => boolean;
  /** Custom message when rate limited */
  message?: string;
  /** Header to indicate remaining requests */
  standardHeaders?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * In-memory store for rate limit tracking.
 * In production, this should be replaced with Redis for distributed systems.
 */
class RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  get(key: string): RateLimitEntry | undefined {
    return this.store.get(key);
  }

  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime <= now) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

// Global store instance
const globalStore = new RateLimitStore();

/**
 * Default key generator using client IP and user ID if available.
 */
function defaultKeyGenerator(c: Context): string {
  const userId = c.get('userId') as string | undefined;
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';

  return userId ? `user:${userId}` : `ip:${ip}`;
}

/**
 * Create a rate limiting middleware with the given configuration.
 *
 * @example
 * ```ts
 * // 100 requests per minute
 * app.use(rateLimit({ limit: 100, windowMs: 60 * 1000 }));
 *
 * // 10 requests per minute for expensive endpoints
 * app.use('/api/ai/*', rateLimit({ limit: 10, windowMs: 60 * 1000 }));
 * ```
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    limit,
    windowMs,
    keyGenerator = defaultKeyGenerator,
    skip,
    message = 'Too many requests, please try again later.',
    standardHeaders = true,
  } = config;

  return async function rateLimitMiddleware(c: Context, next: Next): Promise<void> {
    // Check if this request should skip rate limiting
    if (skip?.(c)) {
      await next();
      return;
    }

    const key = keyGenerator(c);
    const now = Date.now();

    let entry = globalStore.get(key);

    // If no entry or window has passed, create new entry
    if (!entry || entry.resetTime <= now) {
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      globalStore.set(key, entry);
    } else {
      // Increment count
      entry.count++;
      globalStore.set(key, entry);
    }

    // Calculate remaining requests
    const remaining = Math.max(0, limit - entry.count);
    const resetTimeSeconds = Math.ceil(entry.resetTime / 1000);

    // Set standard rate limit headers
    if (standardHeaders) {
      c.header('X-RateLimit-Limit', String(limit));
      c.header('X-RateLimit-Remaining', String(remaining));
      c.header('X-RateLimit-Reset', String(resetTimeSeconds));
    }

    // Check if over limit
    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      c.header('Retry-After', String(retryAfter));

      throw new HTTPException(429, {
        message,
        res: new Response(JSON.stringify({ error: message, retryAfter }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        }),
      });
    }

    await next();
  };
}

/**
 * Preset rate limit configurations.
 */
export const rateLimits = {
  /** Standard API rate limit: 100 requests per minute */
  standard: { limit: 100, windowMs: 60 * 1000 },

  /** Strict rate limit: 20 requests per minute */
  strict: { limit: 20, windowMs: 60 * 1000 },

  /** Auth endpoints: 10 requests per minute */
  auth: { limit: 10, windowMs: 60 * 1000 },

  /** AI/expensive operations: 5 requests per minute */
  ai: { limit: 5, windowMs: 60 * 1000 },

  /** File upload: 20 requests per hour */
  upload: { limit: 20, windowMs: 60 * 60 * 1000 },

  /** Export operations: 5 requests per hour */
  export: { limit: 5, windowMs: 60 * 60 * 1000 },
} as const;

/**
 * Create a per-endpoint rate limiter.
 * Includes the endpoint path in the rate limit key.
 */
export function endpointRateLimit(config: RateLimitConfig) {
  return rateLimit({
    ...config,
    keyGenerator: (c) => {
      const baseKey = (config.keyGenerator ?? defaultKeyGenerator)(c);
      const path = new URL(c.req.url).pathname;
      return `${baseKey}:${path}`;
    },
  });
}

// Export for testing
export { globalStore as _testStore };
