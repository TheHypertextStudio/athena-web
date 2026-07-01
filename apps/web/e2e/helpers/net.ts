/**
 * Same-origin API helpers that carry the session cookie, run inside the page context.
 *
 * @remarks
 * Replaces the several hand-rolled `page.evaluate(fetch(..., { credentials: 'include' }))` variants
 * that specs and `app.ts` each re-wrote. Use {@link apiFetch} when you want the raw status,
 * {@link apiJson} when you want the typed body (throws on non-2xx), and {@link waitForApiResponse}
 * to await a response by URL/method instead of an ad-hoc `page.on('response')` listener.
 */
import type { Page, Response } from '@playwright/test';

/** Request options for {@link apiFetch}/{@link apiJson}; a `body` is JSON-encoded automatically. */
export interface ApiInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** The outcome of {@link apiFetch}: HTTP status plus the parsed JSON body (or raw text/null). */
export interface ApiResult {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Call a same-origin `path` from the page (session cookie included) and return status + body.
 *
 * @remarks
 * Runs the `fetch` in the browser via `page.evaluate` so it rides the app's cookies. A JSON body is
 * stringified with a `content-type: application/json` header; the response is parsed as JSON when
 * possible, else returned as text.
 */
export async function apiFetch(page: Page, path: string, init: ApiInit = {}): Promise<ApiResult> {
  return page.evaluate(
    async ({ p, i }) => {
      const res = await fetch(p, {
        method: i.method ?? 'GET',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          ...(i.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...i.headers,
        },
        ...(i.body === undefined ? {} : { body: JSON.stringify(i.body) }),
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text; // non-JSON response — return the raw text
      }
      return { status: res.status, ok: res.ok, body };
    },
    { p: path, i: init },
  );
}

/** Like {@link apiFetch} but returns the body typed as `T`, throwing on a non-2xx status. */
export async function apiJson<T>(page: Page, path: string, init: ApiInit = {}): Promise<T> {
  const { status, ok, body } = await apiFetch(page, path, init);
  if (!ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${status}`);
  return body as T;
}

/** Await the first response whose URL matches `urlRe` (optionally constrained to `method`). */
export function waitForApiResponse(
  page: Page,
  urlRe: RegExp,
  opts: { method?: string } = {},
): Promise<Response> {
  return page.waitForResponse(
    (res) => urlRe.test(res.url()) && (!opts.method || res.request().method() === opts.method),
  );
}
