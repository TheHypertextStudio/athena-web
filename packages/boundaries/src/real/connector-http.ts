import type { ConnectorProvider } from '../ports/connector';
import { ConnectorError } from '../ports/connector-error';
import type { HttpClient } from './http';
import { logConnectorError } from './connector-log';

/** Max characters of a provider error body kept for diagnostics (avoids logging huge payloads). */
const ERROR_BODY_SNIPPET_LIMIT = 200;

/** Parse a `Retry-After` header (delta-seconds form) into a number, or undefined. */
function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (header === null) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * A small typed wrapper around the injected {@link HttpClient} for one provider.
 *
 * @remarks
 * Every non-2xx response, network failure, and unparseable body becomes a typed
 * {@link ConnectorError} (never a swallowed empty result), so callers can tell a revoked
 * token (`auth`) from a throttle (`rate_limit`) from an outage (`provider`/`network`). The
 * access token is never logged or included in error messages.
 */
export class ProviderHttp {
  /**
   * @param provider - The provider these calls target (used in errors + logs).
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
   * Issue an authenticated request, validate the response, and parse the JSON body.
   *
   * @throws {ConnectorError} On network failure (`network`), non-2xx status
   *   (`auth`/`rate_limit`/`provider` by code), or an unparseable body (`provider`).
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    init: { headers: Record<string, string>; body?: string },
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.http(`${this.apiBase}${path}`, { method, ...init });
    } catch (cause) {
      logConnectorError({ provider: this.provider, kind: 'network', method, path });
      throw new ConnectorError(
        `${this.provider} API ${method} ${path} could not reach the provider`,
        {
          provider: this.provider,
          kind: 'network',
          cause,
        },
      );
    }

    if (!res.ok) {
      const kind = ConnectorError.kindForStatus(res.status);
      const snippet = await res
        .text()
        .then((t) => t.slice(0, ERROR_BODY_SNIPPET_LIMIT))
        .catch(() => '');
      logConnectorError({ provider: this.provider, kind, method, path, status: res.status });
      const retryAfterSeconds = res.status === 429 ? parseRetryAfter(res) : undefined;
      throw new ConnectorError(
        `${this.provider} API ${method} ${path} failed: ${res.status}${snippet ? ` — ${snippet}` : ''}`,
        {
          provider: this.provider,
          kind,
          status: res.status,
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        },
      );
    }

    // A 204 (or otherwise empty) body is a valid "no content" success — e.g. a Google Tasks
    // DELETE — so resolve to `undefined` rather than failing to parse empty text as JSON.
    // Reading as text first (instead of `res.json()`) is what lets us distinguish empty from
    // malformed. The single `as T` is the unavoidable parse boundary: raw JSON has no static
    // shape, so the typed accessors below assert it for their callers.
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      logConnectorError({
        provider: this.provider,
        kind: 'provider',
        method,
        path,
        status: res.status,
      });
      throw new ConnectorError(`${this.provider} API returned an unparseable response: ${path}`, {
        provider: this.provider,
        kind: 'provider',
        status: res.status,
        cause,
      });
    }
  }

  /**
   * Issue an authenticated `GET` and parse the JSON response.
   *
   * @param path - URL path appended to the provider's API base (must start with `/`).
   * @param extraHeaders - Additional headers merged onto the default Authorization + Accept set.
   * @throws {ConnectorError} On network failure, non-2xx status, or an unparseable body.
   */
  async getJson<T = unknown>(path: string, extraHeaders: Record<string, string> = {}): Promise<T> {
    return this.request<T>('GET', path, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        ...extraHeaders,
      },
    });
  }

  /**
   * Issue an authenticated `POST` of a JSON body and parse the JSON response.
   *
   * @param path - URL path appended to the provider's API base.
   * @param body - Request body, serialized as JSON.
   * @param auth - `'bearer'` (default) prefixes the token; `'raw'` sends it verbatim.
   * @throws {ConnectorError} On network failure, non-2xx status, or an unparseable body.
   */
  async postJson<T = unknown>(
    path: string,
    body: unknown,
    auth: 'bearer' | 'raw' = 'bearer',
  ): Promise<T> {
    return this.request<T>('POST', path, {
      headers: {
        Authorization: auth === 'bearer' ? `Bearer ${this.accessToken}` : this.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Issue an authenticated `PATCH` of a JSON body and parse the JSON response.
   *
   * @param path - URL path appended to the provider's API base.
   * @param body - Request body (typically a partial of the resource), serialized as JSON.
   * @throws {ConnectorError} On network failure, non-2xx status, or an unparseable body.
   */
  async patchJson<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Issue an authenticated `DELETE` and discard the (typically empty) response.
   *
   * @remarks
   * No `Content-Type` is sent (there is no request body), and a `204 No Content` reply — the
   * common success for deletes (e.g. Google Tasks) — resolves cleanly rather than failing to
   * parse an empty body. Non-2xx still throws a typed {@link ConnectorError}.
   *
   * @param path - URL path appended to the provider's API base.
   * @throws {ConnectorError} On network failure or non-2xx status.
   */
  async deleteVoid(path: string): Promise<void> {
    await this.request<undefined>('DELETE', path, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });
  }
}
