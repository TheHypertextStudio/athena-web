/**
 * Refuse a production build that has nowhere to route Publishing's default address.
 *
 * @remarks
 * `NEXT_PUBLIC_BRIEF_HOST` is optional in the client env schema (`clientShared`) because local and
 * preview builds legitimately run without it. A production build has no such excuse — without it,
 * `DefaultAddressRow` renders a bare, meaningless org slug as a "web address" for every workspace.
 * Workers candidates set `STUDIO_DEPLOYMENT_ENV`; existing Vercel deployments retain `VERCEL_ENV`.
 * Both providers enforce the same Publishing readiness guard.
 *
 * @param deploymentEnv - The selected provider's deployment environment at build time.
 * @param briefHost - `process.env['NEXT_PUBLIC_BRIEF_HOST']` at build time.
 * @throws When `deploymentEnv` is `'production'` and `briefHost` is unset.
 */
export function assertPublishingHostConfigured(
  deploymentEnv: string | undefined,
  briefHost: string | undefined,
): void {
  if (deploymentEnv === 'production' && !briefHost) {
    throw new Error(
      'NEXT_PUBLIC_BRIEF_HOST is required for a production build (Publishing has nowhere to route ' +
        "a workspace's default address without it) — see .env.example.",
    );
  }
}
