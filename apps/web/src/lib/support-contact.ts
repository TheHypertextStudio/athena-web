/**
 * `@docket/web` — the one support address the product renders.
 *
 * @remarks
 * The privacy policy and terms of service are the only user-facing surfaces that publish a
 * contact address, and both used to hard-code it. No user-facing Docket URL or identity may stay
 * pinned to the legacy studio apex in source, so the address is resolved from configuration
 * through the shared host contract: when the final domain lands, the cutover is an environment
 * change, not an edit to two React components and a rebuild.
 *
 * There is no hard-coded fallback, and that is the point. The address follows whatever apex the
 * app is actually served from (`NEXT_PUBLIC_APP_URL` → `support@<apex>`), so it is already
 * correct today and stays correct after the move without anyone remembering to touch it.
 * `NEXT_PUBLIC_SUPPORT_EMAIL` overrides it when the mailbox is not `support@`.
 *
 * `NEXT_PUBLIC_` because these are statically rendered marketing pages — the value is inlined at
 * build time and is public by definition (it is printed on the page). See
 * `docs/engineering/domain-cutover.md` §3.2 for the cutover item.
 */
import { env } from '@docket/env/web';

/**
 * Address shown on the privacy and terms pages, and used in their `mailto:` links.
 *
 * @remarks
 * Resolved once at module load. Throws if neither `NEXT_PUBLIC_SUPPORT_EMAIL` nor an app URL is
 * configured — a build that cannot name its own support address would otherwise ship a broken
 * `mailto:` to every visitor, which is worse than failing the build.
 *
 * @example
 * ```tsx
 * <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
 * ```
 */
export const SUPPORT_EMAIL: string = (() => {
  const configured = env.NEXT_PUBLIC_SUPPORT_EMAIL;
  if (configured !== undefined) return configured;
  // Derive `support@<apex>` from the app's own URL. This is not a hard-coded fallback — there is
  // no address written into this file — it is the rule the module's contract has always stated:
  // the address follows whatever apex the app is served from, and the variable above only exists
  // to override it when the mailbox is not `support@`. The derivation was lost with `hosts.ts`,
  // which made a build with no explicit override fail on the privacy page.
  // `NEXT_PUBLIC_APP_URL` is required, so there is always an apex to derive from and no branch
  // here can leave the address unnamed.
  return `support@${new URL(env.NEXT_PUBLIC_APP_URL).hostname.replace(/^www\./, '')}`;
})();
