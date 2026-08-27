/**
 * Connection-owned vocabulary for failures returned by a third-party provider.
 *
 * @remarks
 * This module deliberately describes a structural error shape rather than importing an adapter
 * class. Delivery code can therefore decide whether a connection needs reauthorization without
 * depending on whichever SDK, HTTP client, or compatibility package produced the error.
 */

/**
 * The remediation category for a provider failure.
 *
 * - `auth` — credentials were rejected and the account must reconnect.
 * - `rate_limit` — the provider asked Docket to slow down.
 * - `network` — the request did not reach the provider.
 * - `provider` — the provider returned an unsuccessful or invalid response.
 * - `ambiguous` — the provider may have applied a non-idempotent write before the response failed.
 * - `unknown` — the source could not classify the failure.
 */
export type ProviderErrorKind =
  'auth' | 'rate_limit' | 'network' | 'provider' | 'ambiguous' | 'unknown';

/** Construction options for a {@link ProviderError}. */
export interface ProviderErrorOptions<TProvider extends string = string> {
  /** The third-party provider whose operation failed. */
  readonly provider: TProvider;
  /** The remediation category for the failure. */
  readonly kind: ProviderErrorKind;
  /** The HTTP status, when the provider returned a response. */
  readonly status?: number;
  /** Seconds to wait before retrying, when the provider supplied a retry window. */
  readonly retryAfterSeconds?: number;
  /** The original throwable, preserved for diagnostics. */
  readonly cause?: unknown;
}

/**
 * A provider failure with stable remediation metadata.
 *
 * @remarks
 * Connection adapters throw this class directly. Existing delivery adapters can extend it to
 * preserve their public error identity while sharing the same provider-facing contract.
 */
export class ProviderError<TProvider extends string = string> extends Error {
  /** The remediation category for the failure. */
  readonly kind: ProviderErrorKind;
  /** The third-party provider whose operation failed. */
  readonly provider: TProvider;
  /** The HTTP status, when the provider returned a response. */
  readonly status?: number;
  /** Seconds to wait before retrying, when the provider supplied a retry window. */
  readonly retryAfterSeconds?: number;

  /**
   * @param message - A human-readable, secret-free description of the failure.
   * @param options - The provider, remediation kind, and optional response metadata.
   */
  constructor(message: string, options: ProviderErrorOptions<TProvider>) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.kind = options.kind;
    this.provider = options.provider;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /**
   * Classify an HTTP status into a {@link ProviderErrorKind}.
   *
   * @param status - The provider's response status code.
   * @returns the matching provider failure category.
   */
  static kindForStatus(status: number): ProviderErrorKind {
    return providerErrorKindForStatus(status);
  }

  /** Whether the failure is worth retrying later. */
  get retryable(): boolean {
    return (
      this.kind === 'rate_limit' ||
      this.kind === 'network' ||
      this.kind === 'provider' ||
      this.kind === 'ambiguous'
    );
  }
}

/** A provider failure whose remediation is reauthorization. */
export interface ProviderAuthError {
  readonly kind: 'auth';
}

/**
 * Classify an HTTP response status into a provider error category.
 *
 * @param status - The provider's HTTP response status.
 * @returns `auth` for rejected credentials, `rate_limit` for a throttle, and `provider` otherwise.
 */
export function providerErrorKindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return 'provider';
}

/**
 * Read the provider-error kind off an unknown throwable.
 *
 * @remarks
 * Structural, like the guards below, so an adapter keeps its own error classes and only has to
 * carry the `kind` contract. Anything that is not a classified provider error — a bug in our own
 * reconcile code, a `TypeError`, a timeout we never wrapped — is `unknown`, which is honest: the
 * point of this taxonomy is to say what we actually know.
 *
 * @param value - A caught throwable or other unknown value.
 * @returns the carried kind, or `unknown` when the throwable is not a classified provider error.
 */
export function providerErrorKind(value: unknown): ProviderErrorKind {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return 'unknown';
  const { kind } = value;
  return kind === 'auth' ||
    kind === 'rate_limit' ||
    kind === 'network' ||
    kind === 'provider' ||
    kind === 'ambiguous' ||
    kind === 'unknown'
    ? kind
    : 'unknown';
}

/**
 * Determine whether an unknown throwable represents a reauthorization-required provider failure.
 *
 * @remarks
 * The guard is intentionally structural. Existing adapter errors may retain their own classes,
 * while delivery code only needs this stable `kind` contract to select the reauthorization path.
 *
 * @param value - A caught throwable or other unknown value.
 * @returns Whether the value carries the `auth` provider-error kind.
 */
export function isProviderAuthError(value: unknown): value is ProviderAuthError {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'auth';
}

/**
 * Determine whether a failure means the addressed object no longer exists at the provider.
 *
 * @remarks
 * Separated from other `provider` failures because the remediation differs: a rate limit or bad
 * gateway is retryable against the same id, while a deleted object requires forgetting the id.
 *
 * Structural, like {@link isProviderAuthError}.
 *
 * @param value - A caught throwable or other unknown value.
 * @returns Whether the provider reported the addressed object as missing.
 */
export function isProviderMissingObjectError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'provider' &&
    'status' in value &&
    value.status === 404
  );
}
