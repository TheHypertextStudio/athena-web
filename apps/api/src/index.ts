/**
 * `@docket/api` — package entry exposing the typed RPC contract to consumers.
 *
 * @remarks
 * Clients do `import { hc } from 'hono/client'` + `import type { AppType } from
 * '@docket/api'`. Importing this entry is side-effect-free (no server boot — that
 * lives in `server.ts`). The public web app consumes {@link AppType} (`/v1`); the staff
 * console (`apps/admin`) consumes {@link AdminAppType} (`/admin`).
 */
export type { AppType, AdminAppType } from './app';
export { app, adminApp } from './app';
