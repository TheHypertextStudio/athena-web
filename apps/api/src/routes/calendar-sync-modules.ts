/**
 * `@docket/api` — the production calendar provider sync-module map.
 *
 * @remarks
 * The one place the provider-neutral engine (`calendar-sync-engine.ts`) and the concrete
 * adapters (`calendar-google-adapter.ts`) meet. The engine deliberately never imports any
 * adapter — routes (and adapter-path tests) import THIS module to assemble the map and
 * pass it to `syncCalendarConnections` via its `adapters` option. Adding a provider
 * (Microsoft Graph, CalDAV) means registering its module here, touching neither the
 * engine nor the routes.
 */
import type { CalendarProvider } from '@docket/types';

import {
  createGoogleCalendarSyncModule,
  type GoogleAccessTokenFetcher,
  type GoogleFetchJson,
} from './calendar-google-adapter';
import type { CalendarProviderSyncModule } from './calendar-sync-engine';

/**
 * Build the default provider → sync-module map (currently Google only).
 *
 * @param input.fetchJson - Injectable Google HTTP seam (tests only; production omits it).
 * @param input.getAccessToken - Injectable Better Auth token fetcher (tests only).
 */
export function createDefaultCalendarSyncModules(input?: {
  readonly fetchJson?: GoogleFetchJson;
  readonly getAccessToken?: GoogleAccessTokenFetcher;
}): Partial<Record<CalendarProvider, CalendarProviderSyncModule>> {
  return { google: createGoogleCalendarSyncModule(input) };
}
