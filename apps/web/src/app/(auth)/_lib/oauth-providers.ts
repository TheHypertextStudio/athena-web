/**
 * `(auth)/_lib/oauth-providers` — the OAuth provider display catalog.
 *
 * @remarks
 * Passkeys are the primary, always-available credential; OAuth (Google / GitHub / Linear) is
 * secondary and OPTIONAL. **Which providers are actually available is decided server-side** (a
 * provider is on iff its OAuth client id + secret are configured) and delivered to the client via
 * `GET /v1/config` — see `usePublicConfig`. This module is now purely the display catalog
 * (labels + ordering) that turns those provider ids into buttons; it reads no environment and
 * holds no availability logic, so the client can never drift from real server setup.
 */

/** A secondary OAuth provider the sign-in/up screens can offer. */
export interface OAuthProvider {
  /** The Better Auth provider id (the `socialProviders` key), e.g. `'google'`. */
  readonly id: 'google' | 'github' | 'linear' | 'apple';
  /** The button label, e.g. `'Continue with Google'`. */
  readonly label: string;
}

/** The sign-in button label for each provider id. */
const OAUTH_PROVIDER_LABEL: Record<OAuthProvider['id'], string> = {
  google: 'Continue with Google',
  github: 'Continue with GitHub',
  linear: 'Continue with Linear',
  // Apple's Human Interface Guidelines prescribe this exact wording for the button.
  apple: 'Sign in with Apple',
};

/**
 * The fixed display order of the OAuth providers. Apple is listed first: Apple's guidelines ask
 * for its button to be shown at least as prominently as other sign-in options.
 */
const OAUTH_PROVIDER_ORDER: readonly OAuthProvider['id'][] = [
  'apple',
  'google',
  'github',
  'linear',
];

/**
 * Turn the server-reported set of configured provider ids into ordered, labelled options.
 *
 * @remarks
 * The single place provider ids become display options; the caller gets the ids from
 * `usePublicConfig` (`config.oauthProviders`), never from the environment. Unknown ids are
 * dropped, and the result is in {@link OAUTH_PROVIDER_ORDER}.
 *
 * @param ids - The configured provider ids from `/v1/config`.
 * @returns the labelled options to render, in display order (possibly empty).
 */
export function oauthProviderOptions(ids: readonly string[]): OAuthProvider[] {
  const set = new Set(ids);
  return OAUTH_PROVIDER_ORDER.filter((id) => set.has(id)).map((id) => ({
    id,
    label: OAUTH_PROVIDER_LABEL[id],
  }));
}
