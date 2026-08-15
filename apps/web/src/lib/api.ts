import type { AppType } from '@docket/api/rpc-contract';
import { hc } from 'hono/client';

import { withOfflineOutbox } from '@/components/pwa/offline-write';

/**
 * The typed Hono RPC client for the Docket API.
 *
 * @remarks
 * Built from the `@docket/api/rpc-contract` {@link AppType} contract, so every call is fully typed
 * end-to-end (e.g. `api.v1.orgs.$get()`, `api.v1.orgs[':orgId'].tasks.$post(...)`).
 *
 * The base URL is empty (same-origin): requests resolve to relative paths (`/v1/*`,
 * `/api/auth/*`) which the Next `rewrites` proxy to the API origin. Because the browser
 * stays same-origin, the Better Auth session cookie is attached automatically; the
 * `credentials: 'include'` fetch option ensures the cookie is sent even when the client
 * is reconfigured to a cross-origin base.
 *
 * The `fetch` is wrapped by {@link withOfflineOutbox}, which is the single place a write that could
 * not be delivered becomes a queued one. It is here rather than at each call site because this is
 * already the one function every request in the app passes through — that is what makes offline
 * writing a property of the app rather than a feature individual screens remembered. It only ever
 * acts on a *rejected* request, so a real server error still reaches the caller untouched.
 *
 * @example
 * ```ts
 * const res = await api.v1.orgs.$get();
 * if (res.ok) {
 *   const { items } = await res.json();
 * }
 * ```
 */
export const api = hc<AppType>('', {
  fetch: withOfflineOutbox((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: 'include' }),
  ),
});
