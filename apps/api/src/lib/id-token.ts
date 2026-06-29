/**
 * `@docket/api` — minimal OIDC `id_token` claim reader.
 *
 * @remarks
 * Reads the display claims (`email`/`name`/`picture`) out of a stored Google OIDC `id_token` so a
 * linked identity can be shown by its email rather than its opaque `sub`. The token comes from our
 * own `account` table (Better Auth persisted it at link time), so we **decode** the JWT payload
 * without verifying the signature — it is trusted storage and the value is used only as a display
 * label, never for authorization. Tolerates absent/garbled tokens by returning all-null claims.
 */

/** The display claims read from an OIDC `id_token` (null when the claim is absent). */
export interface IdTokenClaims {
  /** The account's email. */
  readonly email: string | null;
  /** The account holder's display name. */
  readonly name: string | null;
  /** Avatar URL. */
  readonly picture: string | null;
}

const EMPTY: IdTokenClaims = { email: null, name: null, picture: null };

/**
 * Decode the (unverified) payload of a JWT `id_token` into its display claims.
 *
 * @param idToken - The stored OIDC id token, or null when none was persisted.
 * @returns the `email`/`name`/`picture` claims, each null when absent or unparseable.
 */
export function decodeIdTokenClaims(idToken: string | null): IdTokenClaims {
  if (!idToken) return EMPTY;
  const [, payload] = idToken.split('.');
  if (!payload) return EMPTY;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const str = (key: string): string | null =>
      typeof claims[key] === 'string' ? claims[key] : null;
    return { email: str('email'), name: str('name'), picture: str('picture') };
  } catch {
    return EMPTY;
  }
}
