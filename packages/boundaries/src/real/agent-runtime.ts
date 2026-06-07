/**
 * `@docket/boundaries/real` — `RealProviderRuntime`.
 *
 * @remarks
 * The env-driven {@link AgentRuntime} that streams a session from a provider runtime
 * (Athena/Claude/Codex via an HTTP/SSE endpoint). Selected only when its endpoint +
 * key are present and real-shaped (see {@link selectAdapter}) and never in
 * `APP_MODE ∈ {local,test}`. Values come from validated env; the network edge goes
 * through an injectable {@link HttpClient}. No business logic lives here — only the
 * provider I/O edge (`boundaries.md` §4).
 */
import type { AgentRuntime, SessionActivity, StartSessionInput } from '../ports/agent-runtime';
import { defaultHttpClient, type HttpClient } from './http';

/** Validated configuration for {@link RealProviderRuntime} (sourced from env). */
export interface RealProviderRuntimeConfig {
  /** Provider runtime endpoint URL that streams session activities (NDJSON). */
  readonly endpoint: string;
  /** API key/token for the runtime. */
  readonly apiKey: string;
}

/** Parse one NDJSON line into a {@link SessionActivity}, or `null` if blank/invalid. */
function parseActivityLine(line: string): SessionActivity | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const obj = JSON.parse(trimmed) as SessionActivity;
  return obj;
}

/**
 * A real, env-driven agent runtime that streams provider activities.
 *
 * @remarks
 * Issues a single POST to the runtime endpoint and yields each newline-delimited JSON
 * `SessionActivity` from the streamed response body.
 */
export class RealProviderRuntime implements AgentRuntime {
  private readonly config: RealProviderRuntimeConfig;
  private readonly http: HttpClient;

  /**
   * @param config - Validated runtime endpoint + key from env.
   * @param http - HTTP transport (defaults to the platform `fetch`).
   */
  constructor(config: RealProviderRuntimeConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    this.http = http;
  }

  /** {@inheritDoc AgentRuntime.startSession} */
  async *startSession(input: StartSessionInput): AsyncIterable<SessionActivity> {
    const res = await this.http(this.config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Agent runtime failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const activity = parseActivityLine(line);
        if (activity) yield activity;
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const tail = parseActivityLine(buffer);
    if (tail) yield tail;
  }
}
