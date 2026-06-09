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
