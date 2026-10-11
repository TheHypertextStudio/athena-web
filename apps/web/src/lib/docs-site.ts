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
 * @returns The normalized configured origin, or `undefined`.
 * @throws When the configured upstream is not an HTTP origin or points back to this app.
 */
export function docsSiteOrigin(): string | undefined {
  const configured = realEnvValue(process.env['DOCS_MINTLIFY_ORIGIN']);
  if (configured === undefined) return undefined;
  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new Error('DOCS_MINTLIFY_ORIGIN must be an absolute HTTP origin');
  }
  const app = realEnvValue(process.env['NEXT_PUBLIC_APP_URL']);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    (app !== undefined && origin.origin === new URL(app).origin)
  ) {
    throw new Error(
      'DOCS_MINTLIFY_ORIGIN must be a separate HTTP origin without a path or credentials',
    );
  }
  return origin.origin;
}

/**
 * Whether this deployment serves the documentation site at `/docs`.
 *
 * @returns `true` under the same condition that emits the `/docs` rewrites.
 */
export function isDocsSitePublished(): boolean {
  return docsSiteOrigin() !== undefined;
}
