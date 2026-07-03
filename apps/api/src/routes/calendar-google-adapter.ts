/**
 * `@docket/api` — Google Calendar adapter for the provider-neutral calendar sync engine.
 *
 * @remarks
 * Implements {@link CalendarProviderAdapter} (the pull contract) plus the surrounding
 * {@link CalendarProviderSyncModule} (connection discovery, credential resolution, scope
 * capture) that `calendar-sync-engine.ts` drives. Every Google-specific concept — REST
 * endpoints, wire shapes, OAuth scope URLs, the `orderBy`-suppresses-`nextSyncToken`
 * quirk — lives here so the engine stays provider-free.
 */
import { auth } from '@docket/auth';
import { account, type Database } from '@docket/db';
import type {
  CalendarEventAttendee,
  CalendarEventOrganizer,
  CalendarItemPermission,
  CalendarScopeState,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';

import { decodeIdTokenClaims } from '../lib/id-token';

import {
  CalendarReauthRequiredError,
  type CalendarProviderAdapter,
  type CalendarProviderCredentials,
  type CalendarProviderSyncModule,
  type CalendarPullResult,
  type DiscoveredCalendarConnection,
  type ProviderItemSnapshot,
  type ProviderLayerSnapshot,
} from './calendar-sync-engine';

const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const MAX_RESULTS = 2500;

/** Full OAuth scope URL granting read-only Calendar access. */
const GOOGLE_SCOPE_CALENDAR_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';
/** Full OAuth scope URL granting full Calendar read/write access. */
const GOOGLE_SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar';
/** Full OAuth scope URL granting Calendar events read/write access (no calendar-list management). */
const GOOGLE_SCOPE_CALENDAR_EVENTS = 'https://www.googleapis.com/auth/calendar.events';

/**
 * Thrown by {@link defaultFetchJson} when the Google Calendar API responds with a
 * non-2xx status. Carries the HTTP status so callers (e.g. `pullChanges`'s incremental
 * path) can detect the specific "sync token expired" 410 without parsing message text.
 */
export class GoogleCalendarApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleCalendarApiError';
  }
}

/** Injectable Google Calendar HTTP seam: fetch one URL as JSON with a bearer token. */
export type GoogleFetchJson = <T>(url: string, accessToken: string) => Promise<T>;

async function defaultFetchJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new GoogleCalendarApiError(res.status, `Google Calendar request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Fetches a (possibly refreshed) OAuth access token for one linked Google account. */
export type GoogleAccessTokenFetcher = (input: {
  readonly providerId: 'google';
  readonly userId: string;
  readonly accountId: string;
}) => Promise<{ readonly accessToken?: string | null }>;

/** The production {@link GoogleAccessTokenFetcher}: Better Auth's token endpoint (auto-refreshes). */
const defaultGetAccessToken: GoogleAccessTokenFetcher = (input) =>
  auth.api.getAccessToken({ body: input });

// --- Google wire shapes -----------------------------------------------------------
// `Record<string, unknown> &` lets a fetched resource be stored as-is into a `jsonb`
// "provider raw" column without an `as`/`as unknown as` escape hatch at the call site.

type GoogleCalendarListItem = Record<string, unknown> & {
  id?: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
};

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListItem[];
  nextPageToken?: string;
}

interface GoogleEventDate {
  dateTime?: string;
  date?: string;
}

interface GoogleEventPerson {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  optional?: boolean;
  self?: boolean;
}

type GoogleCalendarEventResource = Record<string, unknown> & {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventDate;
  end?: GoogleEventDate;
  organizer?: GoogleEventPerson;
  attendees?: GoogleEventPerson[];
  updated?: string;
  etag?: string;
  recurringEventId?: string;
  /** Whether non-organizer guests may modify the event (Google Calendar event field). */
  guestsCanModify?: boolean;
};

interface GoogleEventsResponse {
  items?: GoogleCalendarEventResource[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/**
 * Normalize one Google Calendar event's edit/delete permissions for the viewer.
 *
 * @remarks
 * `canEditCore` requires the layer itself to allow core edits AND (the viewer organizes
 * the event OR the event allows guest modification); `canDelete` is stricter — it never
 * trusts `guestsCanModify`, only the viewer being the organizer. When either is denied,
 * `readOnlyReason` reflects the more fundamental gate: `'layer_access_role'` when the
 * layer itself is not editable, else `'event_capability'` when the event denies it.
 *
 * @param input.layerEditableCore - Whether the event's layer allows core edits (owner/writer).
 * @param input.event - The raw Google event resource.
 */
export function normalizeGoogleEventPermissions(input: {
  layerEditableCore: boolean;
  event: GoogleCalendarEventResource;
}): CalendarItemPermission {
  const organizerSelf = input.event.organizer?.self === true;
  const guestsCanModify = input.event.guestsCanModify === true;
  const canEditCore = input.layerEditableCore && (organizerSelf || guestsCanModify);
  const canDelete = input.layerEditableCore && organizerSelf;
  const readOnlyReason =
    canEditCore && canDelete
      ? null
      : input.layerEditableCore
        ? ('event_capability' as const)
        : ('layer_access_role' as const);
  return { canEditCore, canDelete, readOnlyReason };
}

/** Map one raw Google event resource to the provider-neutral {@link ProviderItemSnapshot}. */
function toItemSnapshot(
  event: GoogleCalendarEventResource,
  layerEditableCore: boolean,
): ProviderItemSnapshot | null {
  if (!event.id) return null;
  const organizer: CalendarEventOrganizer | null = event.organizer
    ? {
        email: event.organizer.email ?? null,
        displayName: event.organizer.displayName ?? null,
        self: event.organizer.self,
      }
    : null;
  const attendees: CalendarEventAttendee[] = (event.attendees ?? []).map((a) => ({
    email: a.email ?? null,
    displayName: a.displayName ?? null,
    responseStatus: a.responseStatus ?? null,
    optional: a.optional,
    self: a.self,
  }));
  return {
    externalEventId: event.id,
    recurringEventId: event.recurringEventId ?? null,
    status: event.status ?? 'confirmed',
    // Cancelled tombstones may omit `summary` entirely; the engine never overwrites an
    // existing row's title with '' when archiving, so falling back to '' here is safe.
    title: event.summary ?? '',
    description: event.description ?? null,
    location: event.location ?? null,
    htmlLink: event.htmlLink ?? null,
    startsAt: event.start?.dateTime ? new Date(event.start.dateTime) : null,
    endsAt: event.end?.dateTime ? new Date(event.end.dateTime) : null,
    allDayStartDate: event.start?.date ?? null,
    allDayEndDate: event.end?.date ?? null,
    organizer,
    attendees,
    updatedExternalAt: event.updated ? new Date(event.updated) : null,
    externalEtag: event.etag ?? null,
    permissions: normalizeGoogleEventPermissions({ layerEditableCore, event }),
    cancelled: event.status === 'cancelled',
    raw: event,
  };
}

/**
 * Full-window baseline pull: GET events with `singleEvents=true`/`timeMin`/`timeMax`,
 * paginating via `pageToken`, capturing `nextSyncToken` from the final page.
 *
 * @remarks
 * CRITICAL Google API fact: `orderBy` is never sent. `orderBy=startTime` suppresses
 * `nextSyncToken` from the response, which would silently break incremental sync forever
 * — dropping it is required, and harmless, since the read service orders in SQL.
 */
async function fullPull(args: {
  fetchJson: GoogleFetchJson;
  credentials: CalendarProviderCredentials;
  externalLayerId: string;
  window: { timeMin: Date; timeMax: Date };
  layerEditableCore: boolean;
}): Promise<CalendarPullResult> {
  const items: ProviderItemSnapshot[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: String(MAX_RESULTS),
      timeMin: args.window.timeMin.toISOString(),
      timeMax: args.window.timeMax.toISOString(),
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await args.fetchJson<GoogleEventsResponse>(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(args.externalLayerId)}/events?${params.toString()}`,
      args.credentials.accessToken,
    );
    for (const event of res.items ?? []) {
      const snapshot = toItemSnapshot(event, args.layerEditableCore);
      if (snapshot) items.push(snapshot);
    }
    if (res.nextSyncToken) nextSyncToken = res.nextSyncToken;
    pageToken = res.nextPageToken;
  } while (pageToken);
  return { items, nextCursor: nextSyncToken, cursorInvalid: false, full: true };
}

/**
 * Incremental pull: GET events with `syncToken`, paginating via `pageToken` only (never
 * re-sending `syncToken`/`timeMin`/`timeMax`/`orderBy` alongside `pageToken` — Google
 * rejects `timeMin`/`timeMax` combined with `syncToken`). A `410 Gone` means the stored
 * token expired server-side; the engine handles `cursorInvalid` by immediately re-pulling
 * full for this layer only.
 */
async function incrementalPull(args: {
  fetchJson: GoogleFetchJson;
  credentials: CalendarProviderCredentials;
  externalLayerId: string;
  cursor: string;
  layerEditableCore: boolean;
}): Promise<CalendarPullResult> {
  const items: ProviderItemSnapshot[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = args.cursor;
  try {
    do {
      const params = new URLSearchParams({ singleEvents: 'true', maxResults: String(MAX_RESULTS) });
      if (pageToken) params.set('pageToken', pageToken);
      else params.set('syncToken', args.cursor);
      const res = await args.fetchJson<GoogleEventsResponse>(
        `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(args.externalLayerId)}/events?${params.toString()}`,
        args.credentials.accessToken,
      );
      for (const event of res.items ?? []) {
        const snapshot = toItemSnapshot(event, args.layerEditableCore);
        if (snapshot) items.push(snapshot);
      }
      if (res.nextSyncToken) nextSyncToken = res.nextSyncToken;
      pageToken = res.nextPageToken;
    } while (pageToken);
    return { items, nextCursor: nextSyncToken, cursorInvalid: false, full: false };
  } catch (err) {
    if (err instanceof GoogleCalendarApiError && err.status === 410) {
      return { items: [], nextCursor: null, cursorInvalid: true, full: false };
    }
    throw err;
  }
}

/** Build the {@link CalendarProviderAdapter} half of the Google sync module. */
export function createGoogleCalendarAdapter(
  fetchJson: GoogleFetchJson = defaultFetchJson,
): CalendarProviderAdapter {
  return {
    provider: 'google',
    async listLayers({ credentials }) {
      const layers: ProviderLayerSnapshot[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams();
        if (pageToken) params.set('pageToken', pageToken);
        const qs = params.toString();
        const res = await fetchJson<GoogleCalendarListResponse>(
          `${GOOGLE_CALENDAR_BASE}/users/me/calendarList${qs ? `?${qs}` : ''}`,
          credentials.accessToken,
        );
        for (const item of res.items ?? []) {
          if (!item.id) continue;
          layers.push({
            externalLayerId: item.id,
            title: item.summary ?? item.id,
            description: item.description ?? null,
            timezone: item.timeZone ?? null,
            color: item.backgroundColor ?? null,
            accessRole: item.accessRole ?? null,
            primary: item.primary ?? false,
            editableCore: item.accessRole === 'owner' || item.accessRole === 'writer',
          });
        }
        pageToken = res.nextPageToken;
      } while (pageToken);
      return layers;
    },
    pullChanges({ credentials, externalLayerId, cursor, window, layerEditableCore }) {
      if (cursor === null) {
        return fullPull({ fetchJson, credentials, externalLayerId, window, layerEditableCore });
      }
      return incrementalPull({
        fetchJson,
        credentials,
        externalLayerId,
        cursor,
        layerEditableCore,
      });
    },
  };
}

/** Provider-opaque payload {@link discoverGoogleConnections} threads back to itself. */
interface GoogleConnectionRaw {
  readonly userId: string;
  readonly accountId: string;
  readonly scope: string | null;
}

function asGoogleConnectionRaw(connection: DiscoveredCalendarConnection): GoogleConnectionRaw {
  return connection.raw as GoogleConnectionRaw;
}

/** Discover a user's linked Google accounts (Better Auth `account` rows for `providerId: 'google'`). */
export async function discoverGoogleConnections(input: {
  db: Database;
  userId: string;
}): Promise<DiscoveredCalendarConnection[]> {
  const rows = await input.db
    .select()
    .from(account)
    .where(and(eq(account.userId, input.userId), eq(account.providerId, 'google')));
  return rows.map((row) => {
    const claims = decodeIdTokenClaims(row.idToken);
    const raw: GoogleConnectionRaw = {
      userId: input.userId,
      accountId: row.accountId,
      scope: row.scope,
    };
    return {
      externalAccountId: row.accountId,
      accountEmail: claims.email,
      accountName: claims.name,
      accountPictureUrl: claims.picture,
      raw,
    };
  });
}

/**
 * Build the credential-resolution seam: wraps Better Auth's `auth.api.getAccessToken`
 * (transparently refreshing an expired token via the stored refresh token). ANY failure —
 * a missing token or a thrown refresh error — becomes {@link CalendarReauthRequiredError},
 * mirroring `integration-provider.ts`'s `resolveLiveConnectorToken`: never a silent skip,
 * always a single "needs reauth" outcome the engine can act on.
 */
export function createGoogleCredentialResolver(
  getAccessToken: GoogleAccessTokenFetcher = defaultGetAccessToken,
): (connection: DiscoveredCalendarConnection) => Promise<CalendarProviderCredentials> {
  return async (connection) => {
    const raw = asGoogleConnectionRaw(connection);
    try {
      const token = await getAccessToken({
        providerId: 'google',
        userId: raw.userId,
        accountId: raw.accountId,
      });
      if (!token.accessToken) {
        throw new CalendarReauthRequiredError('Google account needs reauthorization');
      }
      return { accessToken: token.accessToken };
    } catch (err) {
      if (err instanceof CalendarReauthRequiredError) throw err;
      throw new CalendarReauthRequiredError('Google account needs reauthorization');
    }
  };
}

/**
 * Whether `grantedScopes` includes `knownScopeUrl`, matched by suffix so both a bare scope
 * (`'calendar.readonly'`) and the full URL form are recognized.
 */
function hasGoogleScope(grantedScopes: readonly string[], knownScopeUrl: string): boolean {
  return grantedScopes.some(
    (scope) => scope === knownScopeUrl || knownScopeUrl.endsWith(`/${scope}`),
  );
}

/**
 * Capture a Google connection's granted OAuth scope state from its Better Auth `account`
 * row's `scope` text column (space- or comma-separated — split defensively on `/[\s,]+/`).
 */
export function captureGoogleScopeState(
  connection: DiscoveredCalendarConnection,
  now: Date,
): CalendarScopeState {
  const raw = asGoogleConnectionRaw(connection);
  const grantedScopes = (raw.scope ?? '').split(/[\s,]+/).filter((s) => s.length > 0);
  return {
    grantedScopes,
    calendarRead:
      hasGoogleScope(grantedScopes, GOOGLE_SCOPE_CALENDAR_READONLY) ||
      hasGoogleScope(grantedScopes, GOOGLE_SCOPE_CALENDAR) ||
      hasGoogleScope(grantedScopes, GOOGLE_SCOPE_CALENDAR_EVENTS),
    calendarWrite:
      hasGoogleScope(grantedScopes, GOOGLE_SCOPE_CALENDAR) ||
      hasGoogleScope(grantedScopes, GOOGLE_SCOPE_CALENDAR_EVENTS),
    capturedAt: now.toISOString(),
  };
}

/** Build the complete Google {@link CalendarProviderSyncModule} the engine's default map uses. */
export function createGoogleCalendarSyncModule(input?: {
  readonly fetchJson?: GoogleFetchJson;
  readonly getAccessToken?: GoogleAccessTokenFetcher;
}): CalendarProviderSyncModule {
  return {
    adapter: createGoogleCalendarAdapter(input?.fetchJson),
    discoverConnections: (discoverInput) => discoverGoogleConnections(discoverInput),
    resolveCredentials: createGoogleCredentialResolver(input?.getAccessToken),
    captureScopeState: captureGoogleScopeState,
  };
}
