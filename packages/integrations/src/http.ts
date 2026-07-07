/**
 * `@docket/integrations` — the shared HTTP transport for real adapters.
 *
 * @remarks
 * Real adapters perform their I/O through an injectable {@link HttpClient} (a
 * `fetch`-shaped function) so the actual network edge is the only non-deterministic
 * part and can be supplied/overridden at the composition root. It defaults to the
 * platform `globalThis.fetch`.
 */

/** A minimal `fetch`-shaped HTTP transport injected into the real adapters. */
export type HttpClient = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The default HTTP client: the platform `globalThis.fetch`.
 *
 * @remarks
 * Resolved lazily per call so an environment without a global `fetch` fails only when
 * a real adapter is actually invoked (never in local/test, which use the mocks).
 */
export const defaultHttpClient: HttpClient = (input, init) => {
  const f = globalThis.fetch;
  if (typeof f !== 'function') {
    throw new Error('No global fetch available; inject an HttpClient into the real adapter.');
  }
  return f(input, init);
};
