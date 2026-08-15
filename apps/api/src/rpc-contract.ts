/**
 * API-owned RPC transport types for application clients.
 *
 * @remarks
 * This named public subpath intentionally has no runtime exports or imports. Web, admin, and
 * future desktop clients can depend on the API's public Hono shapes without importing route
 * composition or server startup behavior.
 */
export type { AdminAppType, AppType } from './app';
