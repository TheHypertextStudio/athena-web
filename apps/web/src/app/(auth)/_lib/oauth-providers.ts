/**
 * `(auth)/_lib/oauth-providers` — the env-gated secondary OAuth providers.
 *
 * @remarks
 * Passkeys are the primary, always-available credential; OAuth (Google / GitHub / Linear) is
 * secondary and OPTIONAL. The server only mounts a provider when its client id/secret are
 * configured, so the UI must render a provider button ONLY when that provider is actually
 * usable — never a dead button that 500s on click. The server secrets are not exposed to the
 * browser, so availability is signalled by a public, build-inlined flag per provider
 * (`NEXT_PUBLIC_OAUTH_*`). In local dev none are set, so {@link configuredOAuthProviders}
 * returns an empty list and the OAuth section is omitted entirely (passkey-only).
 *
 * Each flag is read via a DOT-notation `process.env.NEXT_PUBLIC_…` access (not a bracket/computed
 * key) so the Next/Turbopack bundler statically inlines it into the client bundle. The provider
 * `id` matches the Better Auth `socialProviders` key passed to `authClient.signIn.social`.
 */

/** A secondary OAuth provider the sign-in/up screens can offer when it is configured. */
export interface OAuthProvider {
  /** The Better Auth provider id (the `socialProviders` key), e.g. `'google'`. */
  readonly id: 'google' | 'github' | 'linear';
  /** The button label, e.g. `'Continue with Google'`. */
  readonly label: string;
}

/** Truthy only for a non-empty, non-`"false"`/`"0"` public flag value. */
function isEnabled(flag: string | undefined): boolean {
  if (!flag) return false;
  const normalized = flag.trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'false' && normalized !== '0';
}

/**
 * The OAuth providers configured for this deployment, in display order.
 *
 * @remarks
 * Computed from the build-inlined `NEXT_PUBLIC_OAUTH_*` flags. Returns `[]` when none are
 * configured (e.g. local dev), letting the caller omit the OAuth section without rendering any
 * dead buttons.
 *
 * @returns the list of usable {@link OAuthProvider}s, possibly empty.
 */
export function configuredOAuthProviders(): readonly OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (isEnabled(process.env.NEXT_PUBLIC_OAUTH_GOOGLE)) {
    providers.push({ id: 'google', label: 'Continue with Google' });
  }
  if (isEnabled(process.env.NEXT_PUBLIC_OAUTH_GITHUB)) {
    providers.push({ id: 'github', label: 'Continue with GitHub' });
  }
  if (isEnabled(process.env.NEXT_PUBLIC_OAUTH_LINEAR)) {
    providers.push({ id: 'linear', label: 'Continue with Linear' });
  }
  return providers;
}
