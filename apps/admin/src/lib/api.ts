import type { AdminAppType } from '@docket/api';
import { hc } from 'hono/client';

/**
 * The typed Hono RPC client for the Docket API, scoped by the admin console to the
 * staff-gated `/admin/*` routes.
 *
 * @remarks
 * Built from the `@docket/api` {@link AdminAppType} contract, so every call is fully typed
 * end-to-end (e.g. `api.admin.users.$get(...)`,
 * `api.admin.orgs[':id'].lifecycle.$post(...)`).
 *
 * The base URL is empty (same-origin): requests resolve to relative paths (`/admin/*`,
 * `/api/auth/*`) which the Next `rewrites` proxy to the API origin. Because the browser
 * stays same-origin, the Better Auth session cookie is attached automatically; the
 * `credentials: 'include'` fetch option ensures the cookie is sent even when the client
 * is reconfigured to a cross-origin base. The API resolves that cookie to a `staff_user`
 * row and 403s every admin route when the signed-in user is not staff.
 *
 * @example
 * ```ts
 * const res = await api.admin.metrics.$get();
 * if (res.ok) {
 *   const { totalUsers, totalOrgs } = await res.json();
 * }
 * ```
 */
export const api = hc<AdminAppType>('', {
  fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: 'include' })) as typeof fetch,
});
