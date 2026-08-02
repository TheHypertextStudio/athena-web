import { redirect } from 'next/navigation';

import { appHomeUrl, signUpUrl } from '@/lib/marketing-links';
import { readServerSession } from '@/lib/server-session';

/**
 * Never cached or prerendered: the answer depends entirely on the caller's session cookie.
 *
 * @remarks
 * Reading the session already opts this route out of static rendering; declaring it makes the
 * intent explicit, stops a future build-time optimisation from freezing one visitor's answer for
 * everyone, and keeps Next from speculatively prefetching a redirect.
 */
export const dynamic = 'force-dynamic';

/**
 * `/open` — the landing page's race-free entry point into the product.
 *
 * @remarks
 * Every primary marketing CTA points here in every auth state, and this route decides where "here"
 * actually goes. That indirection buys two things the landing page could not have on its own:
 *
 * **A destination that is correct on the very first paint.** The CTA used to read the session in
 * the browser and swap its `href` when the answer arrived — measured at ~345ms. Anyone clicking
 * inside that window, which is the normal case, was routed into `/sign-up` and then bounced back
 * out. The label still swaps client-side (it is cosmetic and additive); the destination no longer
 * needs to, because it is now baked into the server-rendered HTML as a single static `/open`.
 *
 * **A landing page that stays static.** The alternative is reading `cookies()` in the landing page
 * itself, which opts the whole statically-served, SEO-relevant marketing page out of static
 * rendering for the sake of one button's target — the exact trade `marketing-cta.tsx` documents and
 * declines. A tiny dynamic route pays that cost only for people who actually click.
 *
 * `/open` is deliberately not an auth route, so the navigation chain from a landing-page click
 * contains no request or paint for `/sign-in` or `/sign-up` when the visitor is signed in: it goes
 * `/` → `/open` → `/today`.
 *
 * **Why a page and not a Route Handler.** A `route.ts` returning a `307` is the obvious shape, and
 * it works for a direct browser hit — but `next/link` does not navigate to it. Clicking a `<Link>`
 * whose target is a Route Handler made the App Router abandon the navigation and re-request the
 * landing page instead, so the CTA appeared to do nothing (verified against the running dev stack).
 * A Server Component that calls `redirect()` is handled natively by the client router: the RSC
 * navigation follows the redirect and lands on the destination with no document request at all.
 * The page renders no markup — `redirect()` throws before anything is returned — so there is
 * nothing to paint either way.
 *
 * @returns Never — `redirect()` always throws.
 */
export default async function OpenPage(): Promise<never> {
  const session = await readServerSession();
  redirect(session.state === 'authenticated' ? appHomeUrl : signUpUrl);
}
