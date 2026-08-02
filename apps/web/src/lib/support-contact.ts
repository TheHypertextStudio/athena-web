/**
 * `@docket/web` — the one support address the product renders.
 *
 * @remarks
 * The privacy policy and terms of service are the only user-facing surfaces that publish a
 * contact address, and both used to hard-code it. GEN-25 requires that no user-facing Docket URL
 * or identity stay pinned to `hypertext.studio` in source, so the address is read from
 * configuration: when the final domain lands, the cutover is setting one environment variable in
 * the Vercel project, not editing two React components and shipping a build.
 *
 * `NEXT_PUBLIC_` because these are statically rendered marketing pages — the value is inlined at
 * build time and is public by definition (it is printed on the page). The fallback keeps today's
 * behavior byte-for-byte while the new domain is still pending, so this change is inert until the
 * variable is set. See `docs/engineering/domain-cutover.md` for the cutover item that sets it.
 */

/**
 * Address shown on the privacy and terms pages, and used in their `mailto:` links.
 *
 * @remarks
 * Read from `NEXT_PUBLIC_SUPPORT_EMAIL`, falling back to the address in use today.
 *
 * @example
 * ```tsx
 * <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
 * ```
 */
export const SUPPORT_EMAIL: string =
  process.env['NEXT_PUBLIC_SUPPORT_EMAIL'] ?? 'support@hypertext.studio';
