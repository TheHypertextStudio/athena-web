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
import { randomBytes, randomUUID } from 'node:crypto';

import { auth } from '@docket/auth';
import { account, type Database } from '@docket/db';
import type {
  CalendarEventAttendee,
  CalendarEventOrganizer,
  CalendarItemPermission,
  CalendarItemWritePatch,
  CalendarScopeState,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';

import { decodeIdTokenClaims } from '../lib/id-token';

import {
  CalendarReauthRequiredError,
  type CalendarDeleteInput,
  type CalendarDeleteResult,
  type CalendarProviderAdapter,
  type CalendarProviderCredentials,
  type CalendarProviderSyncModule,
  type CalendarPullResult,
  type CalendarPushInput,
  type CalendarPushResult,
  type CalendarWatchInput,
  type CalendarWatchResult,
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

/**
 * Optional request shape for a non-GET {@link GoogleFetchJson} call: `pushItem`/
 * `deleteItem`/`startWatch`/`stopWatch` reuse the exact same seam `listLayers`/
 * `pullChanges` use (one HTTP implementation, real or fake) rather than a parallel seam type.
 */
export interface GoogleFetchJsonInit {
  readonly method?: 'POST' | 'PATCH' | 'DELETE';
  /** Extra headers, e.g. `If-Match` for optimistic-concurrency writes. */
  readonly headers?: Record<string, string>;
  /** JSON-serialized as the request body when present. */
  readonly body?: unknown;
}

/** Injectable Google Calendar HTTP seam: fetch one URL as JSON with a bearer token. */
export type GoogleFetchJson = <T>(
  url: string,
  accessToken: string,
  init?: GoogleFetchJsonInit,
) => Promise<T>;

async function defaultFetchJson<T>(
  url: string,
  accessToken: string,
  init?: GoogleFetchJsonInit,
): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    throw new GoogleCalendarApiError(res.status, `Google Calendar request failed (${res.status})`);
  }
  // DELETE (and a 204 PATCH, if Google ever sends one) has no body to parse.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text.length > 0 ? JSON.parse(text) : undefined) as T;
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

/** Build one Google event PATCH body from a {@link CalendarItemWritePatch}. */
function toEventPatchBody(patch: CalendarItemWritePatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body['summary'] = patch.title;
  if (patch.description !== undefined) body['description'] = patch.description;
  if (patch.location !== undefined) body['location'] = patch.location;
  // Whichever shape the patch carries, it always carries BOTH fields of that shape (see
  // `CalendarItemWritePatch`'s remarks) — so `start`/`end` are always built together,
  // giving Google a shape-consistent object even across a timed<->all-day switch.
  if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
    const timeZone = patch.timezone !== undefined ? { timeZone: patch.timezone } : {};
    body['start'] = { dateTime: patch.startsAt, ...timeZone };
    body['end'] = { dateTime: patch.endsAt, ...timeZone };
  } else if (patch.allDayStartDate !== undefined || patch.allDayEndDate !== undefined) {
    body['start'] = { date: patch.allDayStartDate };
    body['end'] = { date: patch.allDayEndDate };
  }
  return body;
}

/** `If-Match` header set, or empty when there is no anchor to send. */
function ifMatchHeaders(baseEtag: string | null): Record<string, string> {
  return baseEtag !== null ? { 'If-Match': baseEtag } : {};
}

/**
 * Map a thrown push/delete error to its {@link CalendarPushResult}/{@link CalendarDeleteResult}
 * outcome. Handles every status the adapter contract names EXCEPT 412, which the callers
 * intercept first (it needs a follow-up GET, not just an outcome literal).
 */
function mapPushError(err: unknown): {
  outcome: 'reauth' | 'permanent' | 'retryable';
  message: string;
} {
  if (err instanceof GoogleCalendarApiError) {
    if (err.status === 401) return { outcome: 'reauth', message: err.message };
    if (err.status === 403 || err.status === 404 || err.status === 400) {
      return { outcome: 'permanent', message: err.message };
    }
    // 429/5xx, and any other unlisted status, are treated as transient — retry rather
    // than silently giving up on an ambiguous code.
    return { outcome: 'retryable', message: err.message };
  }
  const message = err instanceof Error ? err.message : 'Calendar push failed';
  return { outcome: 'retryable', message };
}

/** GET the current event for a 412 conflict's `current` snapshot; any failure -> `null`. */
async function fetchConflictSnapshot(
  fetchJson: GoogleFetchJson,
  url: string,
  accessToken: string,
): Promise<ProviderItemSnapshot | null> {
  try {
    const event = await fetchJson<GoogleCalendarEventResource>(url, accessToken);
    return toItemSnapshot(event, true);
  } catch {
    return null;
  }
}

/**
 * Push a local patch to one Google event: `PATCH .../events/{id}` with `If-Match`.
 *
 * @remarks
 * The returned snapshot's `permissions` uses `layerEditableCore: true` — a push only
 * happens after the write service already confirmed the item was editable, and the
 * outbox executor never persists this snapshot's `permissions` field (only
 * `externalEtag`/`updatedExternalAt`), so the value here is a documented placeholder,
 * not a claim about the viewer's actual access.
 */
async function pushItem(
  fetchJson: GoogleFetchJson,
  input: CalendarPushInput,
): Promise<CalendarPushResult> {
  const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.externalLayerId)}/events/${encodeURIComponent(input.externalEventId)}`;
  try {
    const event = await fetchJson<GoogleCalendarEventResource>(url, input.credentials.accessToken, {
      method: 'PATCH',
      headers: ifMatchHeaders(input.baseEtag),
      body: toEventPatchBody(input.patch),
    });
    const snapshot = toItemSnapshot(event, true);
    /* v8 ignore next -- @preserve defensive: a successful PATCH response always echoes the event id */
    if (snapshot === null) throw new Error('Google event PATCH response missing an id');
    return { outcome: 'applied', item: snapshot };
  } catch (err) {
    if (err instanceof GoogleCalendarApiError && err.status === 412) {
      const current = await fetchConflictSnapshot(fetchJson, url, input.credentials.accessToken);
      return { outcome: 'conflict', current };
    }
    return mapPushError(err);
  }
}

/** Delete one Google event: `DELETE .../events/{id}` with `If-Match`; `410` counts as already-applied. */
async function deleteItem(
  fetchJson: GoogleFetchJson,
  input: CalendarDeleteInput,
): Promise<CalendarDeleteResult> {
  const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.externalLayerId)}/events/${encodeURIComponent(input.externalEventId)}`;
  try {
    await fetchJson<unknown>(url, input.credentials.accessToken, {
      method: 'DELETE',
      headers: ifMatchHeaders(input.baseEtag),
    });
    return { outcome: 'applied' };
  } catch (err) {
    if (err instanceof GoogleCalendarApiError && err.status === 410) {
      return { outcome: 'applied' };
    }
    if (err instanceof GoogleCalendarApiError && err.status === 412) {
      const current = await fetchConflictSnapshot(fetchJson, url, input.credentials.accessToken);
      return { outcome: 'conflict', current };
    }
    return mapPushError(err);
  }
}

/** Google's `channels.watch` response shape (fields this adapter reads). */
interface GoogleWatchResponse {
  resourceId?: string;
  expiration?: string;
}

/**
 * Subscribe one Google calendar to push notifications: `POST
 * .../calendars/{id}/events/watch` with a fresh random `id` (channel id) and `token`,
 * `address: callbackUrl`, `type: 'web_hook'`. Google echoes back `resourceId` and
 * `expiration` (unix ms, as a string).
 */
async function startWatch(
  fetchJson: GoogleFetchJson,
  input: CalendarWatchInput,
): Promise<CalendarWatchResult> {
  const channelId = randomUUID();
  const token = randomBytes(24).toString('base64url');
  const response = await fetchJson<GoogleWatchResponse>(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.externalLayerId)}/events/watch`,
    input.credentials.accessToken,
    {
      method: 'POST',
      body: { id: channelId, token, address: input.callbackUrl, type: 'web_hook' },
    },
  );
  if (!response.resourceId || !response.expiration) {
    throw new Error('Google watch response missing resourceId/expiration');
  }
  return {
    channelId,
    resourceId: response.resourceId,
    token,
    expiresAt: new Date(Number(response.expiration)),
  };
}

/** Unsubscribe a Google watch channel: `POST /channels/stop`. */
async function stopWatch(
  fetchJson: GoogleFetchJson,
  input: { credentials: CalendarProviderCredentials; channelId: string; resourceId: string },
): Promise<void> {
  await fetchJson<unknown>(`${GOOGLE_CALENDAR_BASE}/channels/stop`, input.credentials.accessToken, {
    method: 'POST',
    body: { id: input.channelId, resourceId: input.resourceId },
  });
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
    pushItem: (input) => pushItem(fetchJson, input),
    deleteItem: (input) => deleteItem(fetchJson, input),
    startWatch: (input) => startWatch(fetchJson, input),
    stopWatch: (input) => stopWatch(fetchJson, input),
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

/** The `X-Goog-*` push-notification headers `validateGoogleWebhookHeaders` needs. */
export interface GoogleWebhookHeaders {
  readonly channelToken: string | undefined;
  readonly resourceId: string | undefined;
  readonly resourceState: string | undefined;
}

/** The channel-owning layer fields `validateGoogleWebhookHeaders` checks the headers against. */
export interface GoogleWebhookChannelLayer {
  readonly watchToken: string | null;
  readonly watchResourceId: string | null;
}

/**
 * `'invalid'` (mismatched/missing token or resource id — the caller 404s without
 * distinguishing which part failed), `'sync'` (Google's initial channel-confirmation
 * ping — no event data, no sync to trigger), or `'notify'` (a real change notification —
 * the caller triggers a sync for this layer).
 */
export type GoogleWebhookOutcome = 'invalid' | 'sync' | 'notify';

/**
 * Validate one Google Calendar push-notification request's headers against the layer its
 * `X-Goog-Channel-Id` resolved to (the route owns that DB lookup; this function only
 * checks the headers, so it never touches the database itself).
 *
 * @remarks
 * Google's push body carries no event data — only these headers matter, and the request
 * body is never read for this. `channelToken`/`resourceId` are compared with `!==`
 * (constant-time comparison is unnecessary here: both are opaque server-generated values
 * Google echoes back, not secrets an attacker profits from timing against — the actual
 * secret, `watchToken`, is never guessable from a timing side-channel of one string
 * compare, and Google's own delivery is not adversarial).
 */
export function validateGoogleWebhookHeaders(
  headers: GoogleWebhookHeaders,
  layer: GoogleWebhookChannelLayer,
): GoogleWebhookOutcome {
  if (
    layer.watchToken === null ||
    layer.watchResourceId === null ||
    headers.channelToken !== layer.watchToken ||
    headers.resourceId !== layer.watchResourceId
  ) {
    return 'invalid';
  }
  return headers.resourceState === 'sync' ? 'sync' : 'notify';
}
