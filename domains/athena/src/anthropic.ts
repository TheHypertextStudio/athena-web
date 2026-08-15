/**
 * Shared Anthropic SDK boundary for Athena's live adapters.
 *
 * Keeping client construction here means a provider credential or gateway option cannot drift
 * between a conversational session and a scheduled digest.
 */
import Anthropic from '@anthropic-ai/sdk';

/** The credential and optional gateway values required by an Anthropic-backed adapter. */
export interface AnthropicClientConfig {
  /** Anthropic API key (`sk-ant-...`). */
  readonly apiKey: string;
  /** Optional base URL, such as a provider gateway. */
  readonly baseURL?: string;
  /** Optional Cloudflare AI Gateway credential. */
  readonly gatewayToken?: string;
}

/** Translate Athena's configuration into the provider SDK's construction options. */
export function anthropicClientOptions(
  config: AnthropicClientConfig,
): ConstructorParameters<typeof Anthropic>[0] {
  return {
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.gatewayToken
      ? { defaultHeaders: { Authorization: `Bearer ${config.gatewayToken}` } }
      : {}),
  };
}

/** Construct an Anthropic SDK client from already-validated Athena configuration. */
export function makeAnthropicClient(config: AnthropicClientConfig): Anthropic {
  return new Anthropic(anthropicClientOptions(config));
}

/**
 * Turn arbitrary provider failures into a useful, secret-free error.
 *
 * @param cause - The value thrown by an SDK or network operation.
 * @param label - The Athena operation that failed.
 */
export function wrapAnthropicError(cause: unknown, label: string): Error {
  if (cause instanceof Anthropic.APIError) {
    const rawStatus: unknown = (cause as { status?: unknown }).status;
    const status = typeof rawStatus === 'number' ? rawStatus : 'unknown';
    return new Error(`Anthropic ${label} failed: ${status} (${cause.name})`);
  }
  if (cause instanceof Error) return new Error(`Anthropic ${label} failed: ${cause.message}`);
  return new Error(`Anthropic ${label} failed: unknown error`);
}
