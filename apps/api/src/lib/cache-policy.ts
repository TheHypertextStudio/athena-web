/**
 * `@docket/api` — the default caching policy for the product API.
 *
 * @remarks
 * Every `/v1` response is one person's view of one workspace. Until this middleware existed
 * none of them said so: no `Cache-Control`, and no `Vary` naming the credentials the body
 * depends on. That combination is worse than it sounds, because the responses now carry an
 * `ETag`. A cache with a validator and no explicit freshness directive is invited by RFC 9111
 * §4.2.2 to apply a *heuristic* lifetime and reuse the stored response — and with nothing in
 * `Vary` tying the entry to the caller, a shared cache keyed on the URL alone could hand one
 * user's tasks to the next.
 *
 * So the default is `private, no-cache`:
 *
 * - `private` keeps the response out of shared caches entirely. Only the browser that made the
 *   request may store it.
 * - `no-cache` does **not** mean "do not store". It means "do not reuse without revalidating",
 *   which is exactly the contract an `ETag` exists to serve: the browser keeps the body, sends
 *   `If-None-Match`, and gets a `304` when nothing changed. Freshness is checked every time and
 *   the payload is still saved.
 *
 * `Vary` names `Cookie` and `Authorization` on top of whatever CORS already added, so no cache
 * layer can key an entry by URL alone. This is defence in depth: `private` should already have
 * kept a shared cache out, and `Vary` means a misconfigured one still cannot cross users.
 *
 * A handler that has said something more specific — the immutable image URL, the SSE streams —
 * keeps its own answer. This only fills the silence.
 */
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';

/** Store it if you are the caller's own browser, and revalidate before reusing it. */
const DEFAULT_POLICY = 'private, no-cache';

/** The credentials a `/v1` body depends on, and therefore what a cache must key on. */
const CREDENTIAL_VARY = ['Cookie', 'Authorization'];

/** Merge values into `Vary` without dropping what an earlier middleware put there. */
function widenVary(existing: string | undefined, added: readonly string[]): string {
  const present = new Set(
    (existing ?? '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean)
      .map((field) => field.toLowerCase()),
  );
  const merged = [
    ...(existing
      ? existing
          .split(',')
          .map((field) => field.trim())
          .filter(Boolean)
      : []),
    ...added.filter((field) => !present.has(field.toLowerCase())),
  ];
  return merged.join(', ');
}

/**
 * Declare the default cache policy for a per-user API surface.
 *
 * @remarks
 * Runs after the handler so it can see what the handler decided. A response that already
 * carries `Cache-Control` is left alone: the immutable document-image URL and the SSE streams
 * each know something this middleware does not.
 */
export const cachePolicy: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', DEFAULT_POLICY);
  c.res.headers.set('Vary', widenVary(c.res.headers.get('Vary') ?? undefined, CREDENTIAL_VARY));
};
