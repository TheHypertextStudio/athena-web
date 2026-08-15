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
import {
  ProviderError,
  type ProviderErrorKind,
  type ProviderErrorOptions,
} from '@docket/connections/provider-error';

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
export type ConnectorErrorKind = ProviderErrorKind;

/** Construction options for a {@link ConnectorError}. */
export interface ConnectorErrorOptions extends ProviderErrorOptions<
  ConnectorProvider | LegacyConnectorProvider
> {
  /** The integration-facing provider accepted by the generic connector port. */
  readonly provider: ConnectorProvider | LegacyConnectorProvider;
}

/** A typed connector failure carrying its {@link ConnectorErrorKind} for the caller to act on. */
export class ConnectorError extends ProviderError<ConnectorProvider | LegacyConnectorProvider> {
  /**
   * @param message - A human-readable, secret-free description of the failure.
   * @param options - The provider, kind, and optional status/retry/cause metadata.
   */
  constructor(message: string, options: ConnectorErrorOptions) {
    super(message, options);
    this.name = 'ConnectorError';
  }

  /**
   * Classify an HTTP status into a {@link ConnectorErrorKind}.
   *
   * @param status - The response status code.
   * @returns the matching kind (`auth` for 401/403, `rate_limit` for 429, else `provider`).
   */
  static override kindForStatus(status: number): ConnectorErrorKind {
    return ProviderError.kindForStatus(status);
  }
}

/** Narrow an unknown throwable to a {@link ConnectorError}. */
export function isConnectorError(value: unknown): value is ConnectorError {
  return value instanceof ConnectorError;
}
