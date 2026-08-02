/**
 * The one open-redirect guard every auth-adjacent return path in the web app resolves through.
 *
 * @remarks
 * There are two callers with two different notions of "here" — the browser knows its real origin,
 * and a Server Component has none it can compare against — so they used to carry two near-identical
 * copies of this check: `safeSameOriginPath` in `components/app-shell-utils.tsx` and
 * `safeServerReturnPath` in `lib/server-session.ts`. Both are still exported under those names,
 * because each has a different contract about what to do when there is no window, but the actual
 * URL reasoning happens exactly once, here.
 *
 * Deliberately free of `window`, `next/headers` and React, so both a `'use client'` module and a
 * server-only one can import it.
 */

/**
 * Resolve `value` against `origin`, rejecting anything that would leave it.
 *
 * @remarks
 * Uses the native `URL` parser rather than hand-rolled prefix checks, and compares the *resolved*
 * origin rather than pattern-matching the raw string. That is what rejects the forms a manual
 * `startsWith('/')` never sees: an absolute `https://evil.example/…`, a protocol-relative
 * `//evil.example`, and the backslash and unicode variants a browser normalises into one before any
 * string check would run.
 *
 * The return value is rebuilt as `pathname + search + hash`, so even for an input that passes, no
 * attacker-chosen origin, credentials or port can ride along into the caller's redirect.
 *
 * Returns `null` rather than a fallback destination: each caller picks its own landing place, and
 * baking one in here would quietly send someone to the wrong surface instead of the caller's.
 *
 * @param value - The raw candidate, typically a `?callbackURL=` query value.
 * @param origin - The origin the value must resolve within.
 * @returns The safe same-origin path, or `null` when the value is absent, unparseable, or elsewhere.
 *
 * @example
 * ```typescript
 * sameOriginPath('/settings/athena?tab=mcp', 'https://docket.app'); // '/settings/athena?tab=mcp'
 * sameOriginPath('//evil.example', 'https://docket.app');           // null
 * ```
 */
export function sameOriginPath(value: string | null | undefined, origin: string): string | null {
  if (!value) return null;
  try {
    const resolved = new URL(value, origin);
    if (resolved.origin !== origin) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}
