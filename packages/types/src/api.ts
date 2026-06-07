/**
 * `@docket/types/api` — RPC contract pointer.
 *
 * @remarks
 * The Hono RPC `AppType` lives in `@docket/api` and is imported from there directly
 * (`import type { AppType } from '@docket/api'`). It is deliberately NOT re-exported
 * here: `@docket/api` depends on `@docket/types` for its DTOs, so a re-export would
 * make `@docket/types` depend on `@docket/api` and create a build cycle (turbo
 * rejects it). This module is kept as the documented pointer to the contract's home.
 */
export {};
