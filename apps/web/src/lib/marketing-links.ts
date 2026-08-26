/**
 * Marketing site — links to sign-in / sign-up.
 *
 * @remarks
 * Now that marketing lives in the same Next.js app as the product, these are
 * plain in-app paths rather than absolute cross-origin URLs. Use with Next's
 * `<Link>` for prefetching, or as `href` on `Button asChild`.
 */

/** Deep link to the sign-up screen (primary conversion target). */
export const signUpUrl = '/sign-up';

/** Deep link to the sign-in screen (returning users). */
export const signInUrl = '/sign-in';

/**
 * Where an already-signed-in reader is sent instead of the auth funnel.
 *
 * @remarks
 * The Hub cockpit — the same landing destination `sign-in/sign-in-client.tsx` uses once a ceremony
 * completes. This is the *destination*, not the entry point: marketing CTAs go through
 * {@link openAppUrl} instead, which resolves to this on the server once the session is confirmed.
 */
export const appHomeUrl = '/today';

/**
 * The one entry point every primary marketing CTA points at, in every auth state.
 *
 * @remarks
 * `apps/web/src/app/open/page.tsx` — a Server Component that reads the session and `redirect()`s a
 * signed-in person to {@link appHomeUrl} and everyone else to {@link signUpUrl}.
 *
 * It exists because a client-resolved destination is a race, and the race was losing. The CTA read
 * the session in the browser and rendered the visitor treatment until it settled — measured at
 * ~345ms — so anyone clicking at normal human speed was sent into the auth funnel and bounced back
 * out. A server-resolved hop is correct on the first paint, and keeps the marketing page itself
 * static because nothing on it has to touch `cookies()`.
 */
export const openAppUrl = '/open';

/** Authenticated organization chooser for the Docket Pro pricing action. */
export const startDocketProUrl = '/billing/start';
