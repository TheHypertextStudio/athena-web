/** Production Google Calendar HTTP transport for canonical work-location sync. */
import { auth } from '@docket/auth';

import { addCalendarDays } from '@docket/planning/calendar-date';
import { instantAt, localDateString } from '@docket/planning/zoned-time';
import type { GoogleWorkingLocationEvent } from './google';
import type { GoogleWorkLocationTransport } from './sync-engine';

const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const MAX_RESULTS = 2_500;

/** Non-GET request metadata for the injectable Google HTTP seam. */
export interface GoogleWorkLocationFetchInit {
  readonly method?: 'POST' | 'PATCH' | 'DELETE';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/** Injectable JSON HTTP seam used by transport mapping tests. */
export type GoogleWorkLocationFetch = <T>(
  url: string,
  accessToken: string,
  init?: GoogleWorkLocationFetchInit,
) => Promise<T>;

/** Access-token seam; Better Auth refreshes linked Google credentials in production. */
export type GoogleWorkLocationTokenFetcher = (input: {
  readonly providerId: 'google';
  readonly userId: string;
  readonly accountId: string;
}) => Promise<{ readonly accessToken?: string | null }>;

/** Status-carrying Google API failure used for sync-token and idempotent-create handling. */
export class GoogleWorkLocationApiError extends Error {
  constructor(readonly status: number) {
    super(`Google work-location request failed (${String(status)})`);
    this.name = 'GoogleWorkLocationApiError';
  }
}

/** Default bearer-authenticated JSON fetch implementation. */
async function defaultFetchJson<T>(
  url: string,
  accessToken: string,
  init?: GoogleWorkLocationFetchInit,
): Promise<T> {
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) throw new GoogleWorkLocationApiError(response.status);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const defaultGetAccessToken: GoogleWorkLocationTokenFetcher = (input) =>
  auth.api.getAccessToken({ body: input });

interface GoogleEventsPage {
  readonly items?: GoogleWorkingLocationEvent[];
  readonly nextPageToken?: string;
  readonly nextSyncToken?: string;
}

interface GoogleWatchResponse {
  readonly resourceId?: string;
  readonly expiration?: string;
}

/** Require a fresh access token for one linked account without exposing credentials to callers. */
async function accessToken(
  getAccessToken: GoogleWorkLocationTokenFetcher,
  input: { readonly userId: string; readonly externalAccountId: string },
): Promise<string> {
  const token = await getAccessToken({
    providerId: 'google',
    userId: input.userId,
    accountId: input.externalAccountId,
  });
  if (!token.accessToken) throw new GoogleWorkLocationApiError(401);
  return token.accessToken;
}

/** Pull full or incremental working-location changes from the primary calendar only. */
async function pullEvents(
  fetchJson: GoogleWorkLocationFetch,
  token: string,
  cursor: string | null,
): Promise<{ events: GoogleWorkingLocationEvent[]; nextCursor: string | null }> {
  const events: GoogleWorkingLocationEvent[] = [];
  let pageToken: string | undefined;
  let nextCursor = cursor;
  do {
    const params = new URLSearchParams({
      eventTypes: 'workingLocation',
      singleEvents: 'false',
      showDeleted: 'true',
      maxResults: String(MAX_RESULTS),
    });
    if (pageToken) params.set('pageToken', pageToken);
    else if (cursor) params.set('syncToken', cursor);
    const page = await fetchJson<GoogleEventsPage>(
      `${GOOGLE_CALENDAR_BASE}/calendars/primary/events?${params.toString()}`,
      token,
    );
    events.push(...(page.items ?? []));
    nextCursor = page.nextSyncToken ?? nextCursor;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { events, nextCursor };
}

/** Build the real transport; tests inject HTTP/token seams while production uses defaults. */
export function createGoogleWorkLocationTransport(input?: {
  readonly fetchJson?: GoogleWorkLocationFetch;
  readonly getAccessToken?: GoogleWorkLocationTokenFetcher;
}): GoogleWorkLocationTransport {
  const fetchJson = input?.fetchJson ?? defaultFetchJson;
  const getAccessToken = input?.getAccessToken ?? defaultGetAccessToken;
  return {
    async pull(request) {
      const token = await accessToken(getAccessToken, request);
      try {
        return await pullEvents(fetchJson, token, request.cursor);
      } catch (error) {
        if (
          request.cursor !== null &&
          error instanceof GoogleWorkLocationApiError &&
          error.status === 410
        ) {
          return pullEvents(fetchJson, token, null);
        }
        throw error;
      }
    },
    async upsert(request) {
      const token = await accessToken(getAccessToken, request);
      const eventUrl = `${GOOGLE_CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(request.externalEventId)}`;
      if (request.externalEtag) {
        return fetchJson<GoogleWorkingLocationEvent>(eventUrl, token, {
          method: 'PATCH',
          headers: { 'If-Match': request.externalEtag },
          body: request.body,
        });
      }
      try {
        return await fetchJson<GoogleWorkingLocationEvent>(
          `${GOOGLE_CALENDAR_BASE}/calendars/primary/events`,
          token,
          { method: 'POST', body: request.body },
        );
      } catch (error) {
        if (error instanceof GoogleWorkLocationApiError && error.status === 409) {
          return fetchJson<GoogleWorkingLocationEvent>(eventUrl, token, {
            method: 'PATCH',
            body: request.body,
          });
        }
        throw error;
      }
    },
    async delete(request) {
      const token = await accessToken(getAccessToken, request);
      try {
        await fetchJson<undefined>(
          `${GOOGLE_CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(request.externalEventId)}`,
          token,
          {
            method: 'DELETE',
            ...(request.externalEtag ? { headers: { 'If-Match': request.externalEtag } } : {}),
          },
        );
      } catch (error) {
        if (
          error instanceof GoogleWorkLocationApiError &&
          (error.status === 404 || error.status === 410)
        ) {
          return;
        }
        throw error;
      }
    },
    async findInstance(request) {
      const token = await accessToken(getAccessToken, request);
      const params = new URLSearchParams({
        timeMin: instantAt(request.occurrenceDate, 0, request.timezone).toISOString(),
        timeMax: instantAt(
          addCalendarDays(request.occurrenceDate, 1),
          0,
          request.timezone,
        ).toISOString(),
        showDeleted: 'true',
        maxResults: '50',
      });
      const response = await fetchJson<GoogleEventsPage>(
        `${GOOGLE_CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(request.masterExternalEventId)}/instances?${params.toString()}`,
        token,
      );
      return (
        response.items?.find((event) => {
          if (event.originalStartTime?.date) {
            return event.originalStartTime.date === request.occurrenceDate;
          }
          if (!event.originalStartTime?.dateTime) return false;
          return (
            localDateString(
              new Date(event.originalStartTime.dateTime),
              event.originalStartTime.timeZone ?? request.timezone,
            ) === request.occurrenceDate
          );
        }) ?? null
      );
    },
    async startWatch(request) {
      const token = await accessToken(getAccessToken, request);
      const response = await fetchJson<GoogleWatchResponse>(
        `${GOOGLE_CALENDAR_BASE}/calendars/primary/events/watch?eventTypes=workingLocation`,
        token,
        {
          method: 'POST',
          body: {
            id: request.channelId,
            type: 'web_hook',
            address: request.callbackUrl,
            token: request.token,
            params: { ttl: '604800' },
          },
        },
      );
      if (!response.resourceId || !response.expiration) throw new GoogleWorkLocationApiError(502);
      return {
        resourceId: response.resourceId,
        expiresAt: new Date(Number(response.expiration)),
      };
    },
  };
}
