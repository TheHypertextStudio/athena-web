/**
 * `apps/marketing` — outbound links into the Docket product app.
 *
 * @remarks
 * The marketing site is a separate deployable from the product app, so its
 * calls-to-action point at an absolute origin rather than an in-app route. That origin
 * comes from the validated `NEXT_PUBLIC_APP_URL` (see `@docket/env/marketing`) — the one
 * environment-specific value that differs between local dev and production; everything
 * else about these links is fixed. Internal marketing routes (`/pricing`, `/about`) use
 * the Next `<Link>` component directly and do not live here.
 */
import { env } from '@docket/env/marketing';

/** Absolute origin of the Docket product app (where sign-in/sign-up live). */
export const appUrl: string = env.NEXT_PUBLIC_APP_URL;

/** Deep link to the product app's sign-up screen (primary conversion target). */
export const signUpUrl = `${appUrl}/sign-up`;

/** Deep link to the product app's sign-in screen (returning users). */
export const signInUrl = `${appUrl}/sign-in`;
