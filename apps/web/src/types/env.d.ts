/**
 * Ambient typings for the build-inlined `NEXT_PUBLIC_*` environment variables.
 *
 * @remarks
 * These public flags must be read via DOT notation (`process.env.NEXT_PUBLIC_FOO`) so
 * Next/Turbopack statically inlines their literal values into the client bundle — a
 * bracket/computed lookup is NOT inlined and reads as `undefined` in the browser. The
 * project's `tsconfig` sets `noPropertyAccessFromIndexSignature`, which would otherwise
 * reject dot access on `ProcessEnv`'s index signature, so each inlinable key is declared
 * here as an explicit, optional property (a missing flag is `undefined` at runtime).
 *
 * This file declares typings only; it must not export runtime values.
 */

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /** Boundary mode; `'local'` runs against the mock adapters (connect works with no OAuth). */
      readonly NEXT_PUBLIC_APP_MODE?: string;
      /** Whether the Google Calendar connector's OAuth is wired in this deployment. */
      readonly NEXT_PUBLIC_CONNECTOR_CALENDAR?: string;
      /** Whether the Google Tasks connector's OAuth is wired in this deployment. */
      readonly NEXT_PUBLIC_CONNECTOR_GTASKS?: string;
      /** Whether the Linear connector's OAuth is wired in this deployment. */
      readonly NEXT_PUBLIC_CONNECTOR_LINEAR?: string;
      /** Whether the Google sign-in OAuth provider is configured. */
      readonly NEXT_PUBLIC_OAUTH_GOOGLE?: string;
      /** Whether the GitHub sign-in OAuth provider is configured. */
      readonly NEXT_PUBLIC_OAUTH_GITHUB?: string;
      /** Whether the Linear sign-in OAuth provider is configured. */
      readonly NEXT_PUBLIC_OAUTH_LINEAR?: string;
      /**
       * The WebAuthn relying-party ID, mirroring the server's required
       * `BETTER_AUTH_PASSKEY_RP_ID`. Required (not a feature flag): the passkey Signal-API
       * cleanup reads it with no fallback, so it must be set for every deployment.
       */
      readonly NEXT_PUBLIC_PASSKEY_RP_ID: string;
    }
  }
}

export {};
