/**
 * `@docket/auth` — shared constants for the sign-up verification intent.
 *
 * @remarks
 * The verified-intent token minted by the {@link signupChallenge} plugin (`signup-challenge.ts`)
 * and consumed by the passkey `resolveUser` ({@link resolvePasskeyUser} in `auth-builder.ts`) is a
 * single-use `verification` row. These constants keep both sides in agreement on the identifier
 * namespace and lifetime without either importing the other (avoids a cycle with `auth-builder`).
 */

/**
 * The `verification.identifier` prefix for a verified-intent row. `resolveUser` requires the passkey
 * registration `context` to carry this exact prefix, so a caller can never smuggle another kind of
 * verification identifier (e.g. a `signup-code:` row keyed by a guessable email) in as an intent.
 */
export const INTENT_IDENTIFIER_PREFIX = 'signup-intent:';

/**
 * Lifetime of both the emailed sign-up code and the verified-intent it mints (10 minutes). Long
 * enough to fetch a code from another device, short enough to bound replay.
 */
export const SIGNUP_CODE_TTL_S = 600;

/** The decoded verified-intent payload (`verification.value`), naming the proven email. */
export interface SignupIntent {
  /** Display name captured at sign-up. */
  readonly name: string;
  /** The email whose ownership the code round-trip proved. */
  readonly email: string;
}
