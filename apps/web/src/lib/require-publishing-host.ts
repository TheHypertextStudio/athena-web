/**
 * Refuse a Vercel production build that has nowhere to route Publishing's default address.
 *
 * @remarks
 * `NEXT_PUBLIC_BRIEF_HOST` is optional in the client env schema (`clientShared`) because local and
 * preview builds legitimately run without it. A production build has no such excuse — without it,
 * `DefaultAddressRow` renders a bare, meaningless org slug as a "web address" for every workspace.
 * Vercel sets `VERCEL_ENV` automatically at build time, so this needs no extra configuration to know
 * which build it's running.
 *
 * @param vercelEnv - `process.env['VERCEL_ENV']` at build time (`'production' | 'preview' | 'development'`, or unset outside Vercel).
 * @param briefHost - `process.env['NEXT_PUBLIC_BRIEF_HOST']` at build time.
 * @throws When `vercelEnv` is `'production'` and `briefHost` is unset.
 */
export function assertPublishingHostConfigured(
  vercelEnv: string | undefined,
  briefHost: string | undefined,
): void {
  if (vercelEnv === 'production' && !briefHost) {
    throw new Error(
      'NEXT_PUBLIC_BRIEF_HOST is required for a production build (Publishing has nowhere to route ' +
        "a workspace's default address without it) — see .env.example.",
    );
  }
}
