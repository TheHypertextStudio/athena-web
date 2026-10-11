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
      /** Frozen platform target; never selects a staging-specific build. */
      readonly DOCKET_RUNTIME_TARGET?: 'workers' | 'node';
      /**
       * The remaining public build RP metadata, mirroring the server's
       * `BETTER_AUTH_PASSKEY_RP_ID`. Optional stale-passkey cleanup uses the existing
       * runtime public-config query; actual ceremonies use server-provided options.
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
