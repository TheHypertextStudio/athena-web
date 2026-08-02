import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { sameOriginPath } from '@/lib/same-origin-path';

/**
 * Server-side (RSC / Route Handler) session read — the authority the entry gate redirects on.
 *
 * @remarks
 * Importing `next/headers` makes this module server-only; never import it as a *value* into a
 * `'use client'` module. A type-only import (`import type { ServerSessionUser } from …`) is erased
 * at compile time and is safe.
 *
 * Why a server read exists at all: every client-side auth gate in this app necessarily paints
 * before it redirects, because a `useEffect` runs after the browser has already committed a frame.
 * That is the observable "flash of the sign-in page" a signed-in person saw when opening the app
 * from the landing page. Deciding on the server means the browser is handed a `307`/`redirect()`
 * instead of an auth-shaped document, so there is nothing to flash.
 *
 * @see `apps/web/src/lib/query-server.ts` — the same origin/cookie forwarding model for RSC data
 * prefetch; this module deliberately mirrors it rather than inventing a second one.
 */

/**
 * Display identity for a server-confirmed session. Structurally `SessionSnapshot` minus `savedAt`.
 */
export interface ServerSessionUser {
  /** Better Auth user id — the value every per-user cache and storage key is partitioned by. */
  readonly userId: string;
  /** Display name, as the account holds it. */
  readonly name: string;
  /** Account email. */
  readonly email: string;
  /** Avatar URL, or `null` when the account has none. */
  readonly image: string | null;
}

/**
 * The three answers a server-side session read can produce.
 *
 * @remarks
 * Three-way, because "no session" and "could not ask" must drive different behaviour — the same
 * distinction `apps/web/src/lib/session-status.ts` already enforces on the client. A boolean cannot
 * hold that difference, and collapsing it is exactly what makes an app shove a sign-in screen at
 * someone whose session is perfectly valid the moment its own API hiccups or the network drops.
 *
 * The contract every caller must honour:
 *
 * - Only `'signed-out'` may redirect a protected route to sign-in.
 * - Only `'authenticated'` may redirect an auth screen into the app.
 * - `'unknown'` must change nothing — render as if the client will settle it, which it will, via
 *   the existing `useSession()` machinery in the shell.
 */
export type ServerSessionState =
  /** The server confirmed a live session, and who it belongs to. */
  | { readonly state: 'authenticated'; readonly user: ServerSessionUser }
  /** The server answered, definitively, that there is no session. */
  | { readonly state: 'signed-out' }
  /** The read failed or was unintelligible. We know nothing; change nothing. */
  | { readonly state: 'unknown' };

/**
 * The origin a server-side return path is resolved against.
 *
 * @remarks
 * A placeholder, and it does not need to be the real one. The question being asked is only "does
 * this value carry an origin of its own?", and any value that does — an absolute
 * `https://evil.example/…`, a protocol-relative `//evil.example`, or a backslash variant a browser
 * normalises into one — resolves somewhere other than the placeholder and is rejected. Only a value
 * that stays put survives, and what comes back is a path, so nothing an attacker chose can ride
 * along into the redirect regardless of which origin was used to test it.
 */
const PLACEHOLDER_ORIGIN = 'http://localhost';

/**
 * A `?callbackURL=` value reduced to a safe same-origin path, or `null`.
 *
 * @remarks
 * The server-side binding of {@link sameOriginPath}, which owns the URL reasoning shared with the
 * browser-side `safeSameOriginPath`. That function cannot simply be called here: it early-returns
 * `null` whenever `window` is undefined, so on the server it would reject every path including the
 * legitimate ones. Binding a different origin — rather than loosening that guard — keeps its "no
 * window, no answer" contract intact while leaving exactly one implementation of the check itself.
 *
 * It lives beside {@link readServerSession} because both halves of the server entry gate need it:
 * the auth screens use it to honour a return-to, and nothing else on the server should be inventing
 * a second open-redirect guard.
 *
 * @param value - The raw `callbackURL` query value.
 * @returns The safe same-origin path, or `null` when the value is absent or points elsewhere.
 *
 * @example
 * ```typescript
 * safeServerReturnPath('/settings/athena?mcp=connected'); // '/settings/athena?mcp=connected'
 * safeServerReturnPath('//evil.example');                 // null
 * ```
 */
export function safeServerReturnPath(value: string | null | undefined): string | null {
  return sameOriginPath(value, PLACEHOLDER_ORIGIN);
}

/** The subset of Better Auth's `/get-session` user object this app displays. */
interface SessionUserPayload {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
}

/**
 * Narrow an unvalidated `/get-session` body to one carrying a usable user.
 *
 * @remarks
 * An explicit guard rather than a cast, because this value crossed a network boundary: a proxy
 * error page, an HTML 502, or a truncated JSON body would all satisfy a cast and then explode on
 * first property access. Anything that fails this check is treated as *not authenticated*, never
 * as a partially-trusted identity.
 *
 * @param value - The parsed response body.
 * @returns Whether `value` carries a `user` with the three string fields the shell needs.
 */
function hasSessionUser(value: unknown): value is { readonly user: SessionUserPayload } {
  if (typeof value !== 'object' || value === null || !('user' in value)) return false;
  const { user } = value;
  if (typeof user !== 'object' || user === null) return false;
  const candidate = user as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    candidate['id'].length > 0 &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['email'] === 'string'
  );
}

/**
 * Read the session server-side through the same-origin `/api/auth/get-session` proxy hop.
 *
 * @remarks
 * Wrapped in React `cache()` — exactly as {@link getServerQueryClient} is — so a layout and every
 * page rendering inside it during one request share a single round trip instead of each paying for
 * their own.
 *
 * The origin is rebuilt from the incoming request's forwarded host so the call goes back through
 * Next's own `/api/auth/*` rewrite to the Hono API. Same-origin matters: the Better Auth session
 * cookie is host-scoped, so forwarding it to any other origin would silently authenticate as
 * nobody and report a false `'signed-out'`.
 *
 * Mapping is strict and deliberately pessimistic:
 *
 * - A thrown fetch (DNS, connection refused, abort) → `'unknown'`.
 * - A non-`2xx` response → `'unknown'`. The API answers `200 null` for "no session", so a `500` is
 *   an outage, not an answer.
 * - A body that parses but carries no usable `user` (including the literal `null` Better Auth
 *   returns for a signed-out caller) → `'signed-out'`.
 * - Only a body with a well-formed `user` → `'authenticated'`.
 *
 * A body that arrives with `2xx` but is unparseable is reported as `'unknown'`, not `'signed-out'`:
 * a mangled body is evidence the transport misbehaved, not evidence about the session.
 *
 * @returns The three-way {@link ServerSessionState} for the current request.
 *
 * @example
 * ```typescript
 * const session = await readServerSession();
 * if (session.state === 'signed-out') redirect('/sign-in');
 * ```
 */
export const readServerSession: () => Promise<ServerSessionState> = cache(
  async (): Promise<ServerSessionState> => {
    const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
    const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host') ?? '';
    if (!host) return { state: 'unknown' };
    const proto = headerStore.get('x-forwarded-proto') ?? 'https';
    const cookie = cookieStore.toString();

    let body: unknown;
    try {
      const response = await fetch(`${proto}://${host}/api/auth/get-session`, {
        headers: { cookie },
        cache: 'no-store',
      });
      if (!response.ok) return { state: 'unknown' };
      body = await response.json();
    } catch {
      return { state: 'unknown' };
    }

    if (!hasSessionUser(body)) return { state: 'signed-out' };

    const { user } = body;
    return {
      state: 'authenticated',
      user: {
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image ?? null,
      },
    };
  },
);
