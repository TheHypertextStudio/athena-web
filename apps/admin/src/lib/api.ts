import type { AppType } from '@docket/api';
import { hc } from 'hono/client';

/**
 * The typed Hono RPC client for the Docket API, scoped by the admin console to the
 * staff-gated `/v1/admin/*` routes.
 *
 * @remarks
 * Built from the `@docket/api` {@link AppType} contract, so every call is fully typed
 * end-to-end (e.g. `api.v1.admin.users.$get(...)`,
 * `api.v1.admin.orgs[':id'].lifecycle.$post(...)`).
 *
 * The base URL is empty (same-origin): requests resolve to relative paths (`/v1/*`,
 * `/api/auth/*`) which the Next `rewrites` proxy to the API origin. Because the browser
 * stays same-origin, the Better Auth session cookie is attached automatically; the
 * `credentials: 'include'` fetch option ensures the cookie is sent even when the client
 * is reconfigured to a cross-origin base. The API resolves that cookie to a `staff_user`
 * row and 403s every admin route when the signed-in user is not staff.
 *
 * @example
 * ```ts
 * const res = await api.v1.admin.metrics.$get();
 * if (res.ok) {
 *   const { totalUsers, totalOrgs } = await res.json();
 * }
 * ```
 */
export const api = hc<AppType>('', {
  fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: 'include' })) as typeof fetch,
});
