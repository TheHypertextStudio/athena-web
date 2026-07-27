/**
 * Single source of truth for the e2e suite's origin, relying-party id, timeouts, and routes.
 *
 * @remarks
 * These were previously duplicated across `playwright.config`, individual specs, and helper
 * docblocks (three separate `docket.localhost` defaults under two env names). Everything now derives
 * from {@link ORIGIN}; `playwright.config.ts` reads it for `baseURL` and `webauthn.ts` reads
 * {@link RP_ID}.
 */

/** The dev origin the specs drive; override with `APP_URL`. */
export const ORIGIN = process.env['APP_URL'] ?? 'https://docket.localhost';

/** The passkey relying-party id — the {@link ORIGIN} host; override with `PASSKEY_RP_ID`. */
export const RP_ID = process.env['PASSKEY_RP_ID'] ?? new URL(ORIGIN).hostname;

/**
 * Named timeouts (ms), replacing the scattered `15_000/30_000/45_000` literals.
 *
 * - `ui` — a single UI element/assertion settling.
 * - `ceremony` — a passkey ceremony (register/authenticate) or verify → navigate.
 * - `sweep` — an async result driven by the in-process dev scheduler (export ready, onboarding commit).
 * - `pageReady` — a route's own client bundle compiling and hydrating for the first time in this
 *   run. `next dev` compiles each route's JS on first request, same as the API routes
 *   `warmUpAuth`/`pollCompiled` pre-warm — but nothing pre-warms the PAGE side, so a form whose
 *   submit button only unlocks post-hydration (see `(auth)/sign-up/page.tsx`'s `canSubmit`) can
 *   sit disabled well past `ui`'s budget on a cold hit. Distinct from `ceremony`: that times a
 *   real network round trip once the page is already interactive, this times the page becoming
 *   interactive at all.
 */
export const TIMEOUTS = {
  ui: 15_000,
  ceremony: 30_000,
  sweep: 45_000,
  pageReady: 60_000,
} as const;

/** An org-scoped route, e.g. `orgHref(orgId, 'today')` → `/orgs/<id>/today`. */
export const orgHref = (orgId: string, path: string): string => `/orgs/${orgId}/${path}`;

/** The active workspace's "My work" route. */
export const myWorkHref = (orgId: string): string => orgHref(orgId, 'my-work');

/** A settings-section route, e.g. `settingsHref(orgId, 'security')` or `'connections/google-calendar'`. */
export const settingsHref = (orgId: string, section: string): string =>
  orgHref(orgId, `settings/${section}`);
