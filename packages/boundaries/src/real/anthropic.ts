/**
 * `@docket/boundaries/real` — shared Anthropic SDK plumbing for the real adapters.
 *
 * @remarks
 * `RealProviderRuntime` (agent runtime) and `RealSummarizer` (daily digest) both construct the
 * same SDK client and wrap thrown SDK/network errors the same way. These two helpers are that
 * shared edge, so the construction + error-translation logic lives in one place.
 */
import Anthropic from '@anthropic-ai/sdk';

/** The env-sourced bits both Anthropic-backed adapters need to build a client. */
export interface AnthropicClientConfig {
  /** Anthropic API key (`sk-ant-...`). */
  readonly apiKey: string;
  /** Base URL override (e.g. a gateway/proxy); defaults to the Anthropic API. */
  readonly baseURL?: string;
}

/** Build an Anthropic SDK client from validated config (the single construction site). */
export function makeAnthropicClient(config: AnthropicClientConfig): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

/**
 * Wrap a thrown SDK/network error as a clear, secret-free {@link Error}.
 *
 * @param cause - The original thrown value.
 * @param label - The adapter label folded into the message (e.g. `agent runtime`, `summarizer`).
 */
export function wrapAnthropicError(cause: unknown, label: string): Error {
  if (cause instanceof Anthropic.APIError) {
    const rawStatus: unknown = (cause as { status?: unknown }).status;
    const status = typeof rawStatus === 'number' ? rawStatus : 'unknown';
    return new Error(`Anthropic ${label} failed: ${status} (${cause.name})`);
  }
  if (cause instanceof Error) {
    return new Error(`Anthropic ${label} failed: ${cause.message}`);
  }
  return new Error(`Anthropic ${label} failed: unknown error`);
}
