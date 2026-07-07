/**
 * Minimal fetch-compatible HTTP edge for blob-store adapters.
 */
export type HttpClient = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Default HTTP client backed by the platform `fetch`.
 */
export const defaultHttpClient: HttpClient = (input, init) => {
  if (typeof fetch !== 'function') {
    throw new Error('No global fetch available; inject an HttpClient into the blob-store adapter.');
  }
  return fetch(input, init);
};
