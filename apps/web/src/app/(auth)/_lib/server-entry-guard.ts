/**
 * `(auth)/_lib/server-entry-guard` — the server half of the auth screens' entry decision.
 *
 * @remarks
 * Server-only: it reaches `readServerSession`, which imports `next/headers`. Never import this
 * from a `'use client'` module — `sign-in-client.tsx` and `sign-up-client.tsx` own the client half
 * (`useRedirectIfAuthenticated`) and must not touch this one.
 *
 * `/sign-in` and `/sign-up` make exactly the same decision on exactly the same inputs, and it was
 * written out twice — the same `first()` reader, the same OAuth-resume detection, the same
 * fallback destination, the same open-redirect handling. Two copies of a security decision is one
 * copy too many: the failure mode is not that both are wrong, it is that a later fix lands on one
 * of them and the other silently keeps the old behaviour on the route nobody was looking at.
 */
import { redirect } from 'next/navigation';

import { readServerSession, safeServerReturnPath } from '@/lib/server-session';

/** A route's `searchParams` in Next 16 — a promise of the parsed query. */
export type AuthScreenSearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Where an already-authenticated visitor lands when the request names no return path. */
const HOME_DESTINATION = '/today';

/**
 * The first value for `key`, treating a repeated param as its first occurrence.
 *
 * @param params - The awaited search params.
 * @param key - The param name.
 * @returns The single string value, or `undefined`.
 */
function first(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Send an already-authenticated visitor out of an auth screen before any markup is produced.
 *
 * @remarks
 * The whole point of deciding here rather than in a `useEffect` is that a `useEffect` runs after
 * the browser has committed a frame. When `/sign-in` was a Client Component, someone with a valid
 * session opening the app from the landing page watched the complete sign-in card paint at ~75ms
 * and only reached `/today` at ~483ms. A `redirect()` before anything is returned means the browser
 * is handed a `307` instead of an auth-shaped document, so there is no frame that could flash.
 *
 * Three cases deliberately do **not** redirect:
 *
 * - `'signed-out'` renders the form, which is the point of the form.
 * - `'unknown'` renders it too. The server could not reach its own API; redirecting on "could not
 *   ask" is how an app denies account creation to someone whose first request happened to race an
 *   API hiccup (see `ServerSessionState`).
 * - A request carrying Better Auth's OAuth resume params (`response_type` **and** `client_id`)
 *   renders even for an authenticated visitor. `oauthProvider` sends an in-flight authorization to
 *   these routes with the original request's raw query attached, and the client half replays it
 *   against the authorize endpoint. Redirecting home would abandon the grant the caller is waiting
 *   on — the session read is not the question being asked.
 *
 * The return-to is resolved through {@link safeServerReturnPath}, so a `?callbackURL=` pointing at
 * another origin falls back to {@link HOME_DESTINATION} instead of being honoured.
 *
 * @param searchParams - The route's `searchParams` promise, passed straight through.
 * @returns Nothing, when the visitor should see the auth screen. Otherwise it never returns.
 *
 * @example
 * ```typescript
 * export default async function SignInPage({ searchParams }: { searchParams: AuthScreenSearchParams }) {
 *   await redirectAuthenticatedVisitor(searchParams);
 *   return <SignInClient />;
 * }
 * ```
 */
export async function redirectAuthenticatedVisitor(
  searchParams: AuthScreenSearchParams,
): Promise<void> {
  const params = await searchParams;
  const resumingAuthorization =
    first(params, 'response_type') !== undefined && first(params, 'client_id') !== undefined;
  if (resumingAuthorization) return;

  const session = await readServerSession();
  if (session.state !== 'authenticated') return;

  redirect(safeServerReturnPath(first(params, 'callbackURL')) ?? HOME_DESTINATION);
}
