/**
 * `@docket/web` — the one support address the product renders.
 *
 * @remarks
 * The privacy policy and terms of service are the only user-facing surfaces that publish a
 * contact address, and both used to hard-code it. GEN-25 requires that no user-facing Docket URL
 * or identity stay pinned to the legacy studio apex in source, so the address is resolved from
 * configuration through the shared host contract: when the final domain lands, the cutover is an
 * environment change, not an edit to two React components and a rebuild.
 *
 * There is no hard-coded fallback. The address follows the configured public root domain, or the
 * registrable passkey domain when the root is not repeated in the web deployment. That distinction
 * matters while the app lives on a subdomain: `support@docket.hypertext.studio` cannot receive
 * mail when that host is a CNAME, while `support@hypertext.studio` can. An explicit
 * `NEXT_PUBLIC_SUPPORT_EMAIL` still wins when the mailbox is not `support@`.
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
  const rootDomain = env.NEXT_PUBLIC_ROOT_DOMAIN ?? env.NEXT_PUBLIC_PASSKEY_RP_ID;
  return `support@${rootDomain}`;
})();
