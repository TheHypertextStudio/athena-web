/**
 * `@docket/integrations` — the typed error every {@link Connector} throws on failure.
 *
 * @remarks
 * Connectors used to swallow failures (`.catch(() => undefined)`, `return []` on a bad-auth
 * response), so a revoked token or provider outage looked indistinguishable from "nothing to
 * import" — the root of connectors *failing silently*. The contract is now explicit: a
 * connector method either returns a real result or throws a {@link ConnectorError} whose
 * `kind` tells the caller WHY, so the API can persist a truthful status, pick the right
 * remediation (re-auth vs retry), and notify the owner. No failure is silent.
 */
import type { ConnectorProvider, LegacyConnectorProvider } from './connector';

/**
 * The category of a connector failure — drives remediation, not just messaging.
 *
 * - `auth` — credential rejected (401/403): the user must re-authorize. NOT retryable.
 * - `rate_limit` — provider throttled the request (429): retryable after `retryAfterSeconds`.
 * - `network` — the request never completed (DNS/timeout/connection): transient, retryable.
 * - `provider` — the provider answered with an error (5xx / other 4xx / bad shape): may be transient.
 * - `unknown` — anything not classified above.
 */
export type ConnectorErrorKind = 'auth' | 'rate_limit' | 'network' | 'provider' | 'unknown';

/** Construction options for a {@link ConnectorError}. */
export interface ConnectorErrorOptions {
  /** The provider the failing call targeted. */
  readonly provider: ConnectorProvider | LegacyConnectorProvider;
  /** The failure category. */
  readonly kind: ConnectorErrorKind;
  /** The HTTP status, when the failure came from a response. */
  readonly status?: number;
  /** Seconds to wait before retrying, parsed from `Retry-After` on a 429. */
  readonly retryAfterSeconds?: number;
  /** The underlying error/throwable, preserved for diagnostics. */
  readonly cause?: unknown;
}

/** A typed connector failure carrying its {@link ConnectorErrorKind} for the caller to act on. */
export class ConnectorError extends Error {
  /** The failure category. */
  readonly kind: ConnectorErrorKind;
  /** The provider the failing call targeted. */
  readonly provider: ConnectorProvider | LegacyConnectorProvider;
  /** The HTTP status, when the failure came from a response. */
  readonly status?: number;
  /** Seconds to wait before retrying (429 `Retry-After`), when known. */
  readonly retryAfterSeconds?: number;

  /**
   * @param message - A human-readable, secret-free description of the failure.
   * @param options - The provider, kind, and optional status/retry/cause metadata.
   */
  constructor(message: string, options: ConnectorErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ConnectorError';
    this.kind = options.kind;
    this.provider = options.provider;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /**
   * Classify an HTTP status into a {@link ConnectorErrorKind}.
   *
   * @param status - The response status code.
   * @returns the matching kind (`auth` for 401/403, `rate_limit` for 429, else `provider`).
   */
  static kindForStatus(status: number): ConnectorErrorKind {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    return 'provider';
  }

  /** Whether the failure is worth retrying later (rate-limit, network, or provider error). */
  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'network' || this.kind === 'provider';
  }
}

/** Narrow an unknown throwable to a {@link ConnectorError}. */
export function isConnectorError(value: unknown): value is ConnectorError {
  return value instanceof ConnectorError;
}
