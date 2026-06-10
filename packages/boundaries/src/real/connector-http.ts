import type { ConnectorProvider } from '../ports/connector';
import type { HttpClient } from './http';

/** A small typed wrapper around the injected {@link HttpClient} for one provider. */
export class ProviderHttp {
  /**
   * @param provider - The provider these calls target (used in error messages).
   * @param apiBase - The provider API base (no trailing slash assumptions).
   * @param accessToken - The bearer token / API key (never logged).
   * @param http - The injected HTTP transport.
   */
  constructor(
    private readonly provider: ConnectorProvider,
    private readonly apiBase: string,
    private readonly accessToken: string,
    private readonly http: HttpClient,
  ) {}

  /**
   * Issue an authenticated `GET` and parse the JSON response.
   *
   * @param path - URL path appended to the provider's API base (must start with `/`).
   * @param extraHeaders - Additional headers merged onto the default Authorization + Accept set.
   * @throws {Error} On non-2xx status or unparseable JSON body.
   */
  async getJson(path: string, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const res = await this.http(`${this.apiBase}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        ...extraHeaders,
      },
    });
    if (!res.ok) {
      throw new Error(`${this.provider} API GET ${path} failed: ${res.status}`);
    }
    try {
      return await res.json();
    } catch {
      throw new Error(`${this.provider} API returned unparseable response: ${path}`);
    }
  }

  /**
   * Issue an authenticated `POST` of a JSON body and parse the JSON response.
   *
   * @param path - URL path appended to the provider's API base.
   * @param body - Request body, serialized as JSON.
   * @param auth - `'bearer'` (default) prefixes the token; `'raw'` sends it verbatim.
   * @throws {Error} On non-2xx status or unparseable JSON body.
   */
  async postJson(path: string, body: unknown, auth: 'bearer' | 'raw' = 'bearer'): Promise<unknown> {
    const res = await this.http(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        Authorization: auth === 'bearer' ? `Bearer ${this.accessToken}` : this.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${this.provider} API POST ${path} failed: ${res.status}`);
    }
    try {
      return await res.json();
    } catch {
      throw new Error(`${this.provider} API returned unparseable response: ${path}`);
    }
  }
}
