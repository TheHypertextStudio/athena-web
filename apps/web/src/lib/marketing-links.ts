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
 * The Hub cockpit — the same landing destination `sign-in/page.tsx` uses once a ceremony completes.
 * Marketing CTAs point here whenever {@link useMarketingAuthState} reports `signed-in`, so someone
 * with a live session is never invited to authenticate again.
 */
export const appHomeUrl = '/today';
