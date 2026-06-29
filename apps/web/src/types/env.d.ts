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
      /**
       * The WebAuthn relying-party ID, mirroring the server's required
       * `BETTER_AUTH_PASSKEY_RP_ID`. Required (not a feature flag): the passkey Signal-API
       * cleanup reads it with no fallback, so it must be set for every deployment.
       *
       * @remarks
       * Provider/connector availability is NOT declared here: it is no longer a build-time flag.
       * The client reads what is configured from the server's `GET /v1/config` (derived from the
       * real credentials) — see `@/lib/public-config` — so there are no `NEXT_PUBLIC_OAUTH_*` /
       * `NEXT_PUBLIC_CONNECTOR_*` / `NEXT_PUBLIC_APP_MODE` mirror flags to drift from setup.
       */
      readonly NEXT_PUBLIC_PASSKEY_RP_ID: string;
    }
  }
}

export {};
