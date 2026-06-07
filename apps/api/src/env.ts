/**
 * `@docket/api` — environment re-export.
 *
 * @remarks
 * Importing this (and thus `@docket/env/api`) at the top of the app means the
 * process refuses to boot with an invalid env contract (fail-fast 12-factor).
 */
export { env } from '@docket/env/api';
