import { realEnvValue } from '@docket/env';

/**
 * `@docket/web` — where the documentation site lives, and whether it is reachable.
 *
 * @remarks
 * `/docs` is not a route in this app; it resolves only via the `next.config.ts` rewrites, which are
 * emitted only when the origin is configured. The rewrite and the nav entries pointing at it must
 * agree, so both read from here. Server-only, fixed at build time.
 */

/**
 * The Mintlify origin serving the documentation, or `undefined` when none is configured.
 *
 * @remarks
 * `realEnvValue`, not a truthiness check: a placeholder left in a project's settings would
 * otherwise point a rewrite at someone else's site under Docket's domain.
 *
 * @returns The configured origin, or `undefined`.
 */
export function docsSiteOrigin(): string | undefined {
  return realEnvValue(process.env['DOCS_MINTLIFY_ORIGIN']);
}

/**
 * Whether this deployment serves the documentation site at `/docs`.
 *
 * @returns `true` under the same condition that emits the `/docs` rewrites.
 */
export function isDocsSitePublished(): boolean {
  return docsSiteOrigin() !== undefined;
}
