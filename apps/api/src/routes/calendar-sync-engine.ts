/**
 * `@docket/api` — provider-neutral calendar sync engine.
 *
 * @remarks
 * Replaces the Google-only polling sync (formerly `google-calendar-sync.ts`) with an
 * engine that drives ANY {@link CalendarProviderAdapter} through the same connection →
 * layer → item pipeline: discover the user's linked accounts for a provider, resolve
 * fresh credentials, capture the granted OAuth scope state, list the provider's
 * calendars (dual-writing `calendar_list`/`calendar_layer`), then for each selected
 * layer take an exclusive lease, pull full-or-incremental changes, and apply them
 * (dual-writing `calendar_event`/`calendar_item`). This module contains NO
 * provider-specific logic, constants, wire shapes, or imports — those live in adapter
 * modules (e.g. `calendar-google-adapter.ts`) that implement
 * {@link CalendarProviderAdapter} and the surrounding {@link CalendarProviderSyncModule},
 * and the provider → module map is assembled outside the engine (see
 * `calendar-sync-modules.ts`) and passed in via options. A future Microsoft Graph or
 * CalDAV adapter plugs in without touching this file.
 *
 * The write outbox (`../calendar/calendar-outbox.ts`) and its `pushItem`/`deleteItem`
 * adapter contract (declared here, implemented per-provider) are the outbound half; this
 * module stays pull-only and provider-free for those — it declares the push/delete
 * contract types so adapters and the outbox agree on a shape, but never calls them.
 *
 * Push-notification `watch` subscriptions (Google Calendar's `channels.watch`) are
 * modeled as sync HINTS, not a replacement for polling: {@link registerOrRenewWatches}
 * registers/renews a channel per selected layer (config-gated on a registered callback
 * URL; no-ops cleanly when unset), and {@link syncSingleLayer} — the SAME per-layer sync
 * logic {@link syncCalendarConnections} uses internally, extracted to `runLayerSync` — is
 * the bounded, single-layer sync a webhook route triggers when a hint arrives. Both paths
 * (scheduled full sweep and push-triggered single-layer sync) end up pulling
 * incrementally via the stored `syncToken`, so a hint never does more work than a normal
 * incremental poll would.
 */
import {
  calendarConnection,
  calendarEvent,
  calendarItem,
  calendarLayer,
  calendarList,
  type Database,
} from '@docket/db';
import {
  type CalendarEventAttendee,
  type CalendarEventOrganizer,
  type CalendarItemPermission,
  type CalendarItemWritePatch,
  CalendarProvider,
  type CalendarScopeState,
  type CalendarSyncResultOut,
} from '@docket/types';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { z } from 'zod';

/** Credentials an adapter needs to call its provider. Resolved per-connection by the engine. */
export interface CalendarProviderCredentials {
  readonly accessToken: string;
}

/** One provider calendar, as reported by {@link CalendarProviderAdapter.listLayers}. */
export interface ProviderLayerSnapshot {
  readonly externalLayerId: string;
  readonly title: string;
  readonly description: string | null;
  readonly timezone: string | null;
  readonly color: string | null;
  readonly accessRole: string | null;
  readonly primary: boolean;
  readonly editableCore: boolean;
}

/** One provider event/item, as reported by {@link CalendarProviderAdapter.pullChanges}. */
export interface ProviderItemSnapshot {
  readonly externalEventId: string;
  readonly recurringEventId: string | null;
  readonly status: string;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly htmlLink: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly allDayStartDate: string | null;
  readonly allDayEndDate: string | null;
  readonly organizer: CalendarEventOrganizer | null;
  readonly attendees: CalendarEventAttendee[];
  readonly updatedExternalAt: Date | null;
  readonly externalEtag: string | null;
  readonly permissions: CalendarItemPermission;
  readonly cancelled: boolean;
  readonly raw: Record<string, unknown>;
}

/** The result of one `pullChanges` call. */
export interface CalendarPullResult {
  readonly items: ProviderItemSnapshot[];
  /** Opaque; stored on the layer as `syncToken` and echoed back as `cursor` next run. */
  readonly nextCursor: string | null;
  /** `true` => the engine clears the stored cursor and immediately re-runs a FULL pull. */
  readonly cursorInvalid: boolean;
  /** Whether this pull was a full-window baseline (`cursor` was `null`). */
  readonly full: boolean;
}

/** Input to {@link CalendarProviderAdapter.pushItem}: apply a local patch to one provider event. */
export interface CalendarPushInput {
  readonly credentials: CalendarProviderCredentials;
  readonly externalLayerId: string;
  readonly externalEventId: string;
  readonly patch: CalendarItemWritePatch;
  /** `If-Match` anchor for optimistic concurrency; `null` means unconditional (never sent by Google). */
  readonly baseEtag: string | null;
}

/** Input to {@link CalendarProviderAdapter.deleteItem}: the same anchor, no patch. */
export interface CalendarDeleteInput {
  readonly credentials: CalendarProviderCredentials;
  readonly externalLayerId: string;
  readonly externalEventId: string;
  readonly baseEtag: string | null;
}

/**
 * The outcome of one {@link CalendarProviderAdapter.pushItem} call.
 *
 * @remarks
 * Every outcome the outbox executor (`calendar-outbox.ts`) must persist against, with no
 * catch-all: `applied` (the provider accepted the write; `item` is the fresh snapshot to
 * stamp locally), `conflict` (the anchor was stale — `current` is a best-effort fresh
 * snapshot, `null` when even the follow-up read failed), `retryable` (transient; back off
 * and retry), `permanent` (will never succeed unmodified; stop retrying), `reauth` (the
 * credential itself is invalid; needs user re-authorization before any retry can help).
 */
export type CalendarPushResult =
  | { readonly outcome: 'applied'; readonly item: ProviderItemSnapshot }
  | { readonly outcome: 'conflict'; readonly current: ProviderItemSnapshot | null }
  | { readonly outcome: 'retryable'; readonly message: string }
  | { readonly outcome: 'permanent'; readonly message: string }
  | { readonly outcome: 'reauth'; readonly message: string };

/**
 * The outcome of one {@link CalendarProviderAdapter.deleteItem} call.
 *
 * @remarks
 * Identical to {@link CalendarPushResult} except `applied` carries no snapshot — a
 * deleted event has nothing left to stamp beyond the archive itself.
 */
export type CalendarDeleteResult =
  | { readonly outcome: 'applied' }
  | { readonly outcome: 'conflict'; readonly current: ProviderItemSnapshot | null }
  | { readonly outcome: 'retryable'; readonly message: string }
  | { readonly outcome: 'permanent'; readonly message: string }
  | { readonly outcome: 'reauth'; readonly message: string };

/** Input to {@link CalendarProviderAdapter.startWatch}: subscribe one layer to push notifications. */
export interface CalendarWatchInput {
  readonly credentials: CalendarProviderCredentials;
  readonly externalLayerId: string;
  /** The public HTTPS URL the provider will POST push-notification pings to. */
  readonly callbackUrl: string;
}

/** The result of a successful {@link CalendarProviderAdapter.startWatch} call, persisted on the layer. */
export interface CalendarWatchResult {
  readonly channelId: string;
  readonly resourceId: string;
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * The provider-neutral pull + push contract every adapter implements.
 *
 * @remarks
 * `startWatch`/`stopWatch` are OPTIONAL — CalDAV (and any future poll-only provider) has
 * no push-notification concept, so callers must check `typeof adapter.startWatch ===
 * 'function'` before calling it, never assume it is present.
 */
export interface CalendarProviderAdapter {
  readonly provider: CalendarProvider;
  listLayers(input: {
    readonly credentials: CalendarProviderCredentials;
  }): Promise<ProviderLayerSnapshot[]>;
  pullChanges(input: {
    readonly credentials: CalendarProviderCredentials;
    readonly externalLayerId: string;
    /** `null` => full sync over `window`. */
    readonly cursor: string | null;
    readonly window: { readonly timeMin: Date; readonly timeMax: Date };
    /**
     * Whether the layer this pull targets currently allows core edits — deliberately NOT
     * in the original sketch of this contract, added because computing an event's full
     * {@link CalendarItemPermission} snapshot (per adapter, e.g. Google's
     * `normalizeGoogleEventPermissions`) requires knowing the layer's access role, and the
     * engine (not the adapter) owns the `calendar_layer` row. This is a provider-neutral
     * boolean, not a Google concept, so it does not compromise adapter neutrality.
     */
    readonly layerEditableCore: boolean;
  }): Promise<CalendarPullResult>;
  /** Push a local patch to one provider event; see {@link CalendarPushResult} for outcomes. */
  pushItem(input: CalendarPushInput): Promise<CalendarPushResult>;
  /** Delete one provider event; see {@link CalendarDeleteResult} for outcomes. */
  deleteItem(input: CalendarDeleteInput): Promise<CalendarDeleteResult>;
  /**
   * Subscribe one layer to provider push notifications. Absent when the provider has no
   * push model. Declared as a property (not method-shorthand) type so callers can safely
   * extract it into a local (`const startWatch = adapter.startWatch`) after the
   * `typeof … === 'function'` guard without an `@typescript-eslint/unbound-method` lint
   * error — none of these methods read `this`, so there is nothing to unbind.
   */
  startWatch?: (input: CalendarWatchInput) => Promise<CalendarWatchResult>;
  /** Unsubscribe a previously-registered watch channel. Absent when the provider has no push model. */
  stopWatch?: (input: {
    readonly credentials: CalendarProviderCredentials;
    readonly channelId: string;
    readonly resourceId: string;
  }) => Promise<void>;
}

/** One discovered linked account for a provider, before credentials/scope are resolved. */
export interface DiscoveredCalendarConnection {
  readonly externalAccountId: string;
  readonly accountEmail: string | null;
  readonly accountName: string | null;
  readonly accountPictureUrl: string | null;
  /**
   * Provider-opaque payload threaded back into `resolveCredentials`/`captureScopeState` for
   * this same connection. The engine never inspects it; only the provider module that
   * produced it (via `discoverConnections`) ever reads it back.
   */
  readonly raw: unknown;
}

/**
 * One provider's full sync wiring: its pull adapter plus connection discovery, credential
 * resolution, and scope-state capture. Grouping these together (rather than just the
 * adapter) is what lets `syncCalendarConnections` dispatch connection-discovery and
 * credential/token concerns per provider while staying provider-free itself.
 */
export interface CalendarProviderSyncModule {
  readonly adapter: CalendarProviderAdapter;
  /** Discover this user's linked accounts for the provider (e.g. Better Auth `account` rows). */
  discoverConnections(input: {
    readonly db: Database;
    readonly userId: string;
  }): Promise<DiscoveredCalendarConnection[]>;
  /** Resolve fresh credentials for one discovered connection. */
  resolveCredentials(
    connection: DiscoveredCalendarConnection,
  ): Promise<CalendarProviderCredentials>;
  /** Capture the connection's current OAuth scope state for persistence on every sync. */
  captureScopeState(connection: DiscoveredCalendarConnection, now: Date): CalendarScopeState;
}

/**
 * Thrown by a provider module's `resolveCredentials` when the linked account's grant is
 * invalid/expired and the user must re-authorize — as opposed to a transient/unknown
 * failure. The engine uses this (provider-neutral) type, not any provider-specific error
 * shape, to decide whether a failed connection is marked `reauth_required` vs `error`.
 */
export class CalendarReauthRequiredError extends Error {}

/** A held layer lease is valid for this long before another run may reclaim it. */
export const LEASE_TTL_MS = 5 * 60 * 1000;

/**
 * Atomically claim one calendar layer's sync lease.
 *
 * @remarks
 * A conditional `UPDATE ... WHERE sync_lease_expires_at IS NULL OR < now RETURNING id`
 * mirrors `integration-sync.ts`'s `claimLease` mechanics (not its tables — calendar is
 * user-scoped and deliberately kept out of the org connector tables).
 *
 * @returns `true` if this caller now holds the lease, `false` if another run holds a fresh one.
 */
export async function claimLayerLease(db: Database, layerId: string, now: Date): Promise<boolean> {
  const claimed = await db
    .update(calendarLayer)
    .set({ syncLeaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS) })
    .where(
      and(
        eq(calendarLayer.id, layerId),
        or(isNull(calendarLayer.syncLeaseExpiresAt), lt(calendarLayer.syncLeaseExpiresAt, now)),
      ),
    )
    .returning({ id: calendarLayer.id });
  return claimed.length > 0;
}

/** Release one calendar layer's sync lease (always called, including on error). */
async function releaseLayerLease(db: Database, layerId: string): Promise<void> {
  await db
    .update(calendarLayer)
    .set({ syncLeaseExpiresAt: null })
    .where(eq(calendarLayer.id, layerId));
}

/** The sync pull window: 30 days back, 180 days forward of `now`. */
function windowBounds(now: Date): { timeMin: Date; timeMax: Date } {
  const timeMin = new Date(now);
  timeMin.setUTCDate(timeMin.getUTCDate() - 30);
  const timeMax = new Date(now);
  timeMax.setUTCDate(timeMax.getUTCDate() + 180);
  return { timeMin, timeMax };
}

/** Find an existing `calendar_connection` id for `(userId, provider, externalAccountId)`. */
async function findConnectionId(
  db: Database,
  input: { userId: string; provider: CalendarProvider; externalAccountId: string },
): Promise<string | null> {
  const rows = await db
    .select({ id: calendarConnection.id })
    .from(calendarConnection)
    .where(
      and(
        eq(calendarConnection.userId, input.userId),
        eq(calendarConnection.provider, input.provider),
        eq(calendarConnection.externalAccountId, input.externalAccountId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Upsert the `calendar_connection` row for one linked account, capturing the freshly
 * resolved scope state on every sync.
 */
async function upsertConnection(
  db: Database,
  input: {
    userId: string;
    provider: CalendarProvider;
    externalAccountId: string;
    accountEmail: string | null;
    accountName: string | null;
    accountPictureUrl: string | null;
    scopeState: CalendarScopeState;
    now: Date;
  },
): Promise<string> {
  const existingId = await findConnectionId(db, input);
  const values = {
    accountEmail: input.accountEmail,
    accountName: input.accountName,
    accountPictureUrl: input.accountPictureUrl,
    status: 'connected' as const,
    scopeState: input.scopeState,
    lastSyncedAt: input.now,
    lastError: null,
  };
  if (existingId !== null) {
    await db.update(calendarConnection).set(values).where(eq(calendarConnection.id, existingId));
    return existingId;
  }
  const inserted = await db
    .insert(calendarConnection)
    .values({
      userId: input.userId,
      provider: input.provider,
      externalAccountId: input.externalAccountId,
      ...values,
    })
    .returning({ id: calendarConnection.id });
  const row = inserted[0];
  if (!row) throw new Error('calendar connection insert returned no row');
  return row.id;
}

/**
 * Dual-write one synced provider calendar: `calendar_list` (legacy) then `calendar_layer`
 * (reusing the list row's id, per the Task 1 backfill), preserving `selected`/
 * `visibleByDefault` on conflict exactly like the pre-engine sync did — those are user
 * preferences owned by the `/me/calendar` visibility routes, not the sync.
 *
 * @returns the shared row id, whether the layer is selected, and its current `syncToken`
 *   (read once here so the caller does not need a second query before pulling).
 */
async function upsertProviderLayer(
  db: Database,
  input: {
    userId: string;
    connectionId: string;
    provider: CalendarProvider;
    snapshot: ProviderLayerSnapshot;
    now: Date;
  },
): Promise<{ id: string; selected: boolean; syncToken: string | null }> {
  const { snapshot } = input;
  const listValues = {
    title: snapshot.title,
    description: snapshot.description,
    timezone: snapshot.timezone,
    color: snapshot.color,
    accessRole: snapshot.accessRole,
    primary: snapshot.primary,
    lastSyncedAt: input.now,
    lastError: null,
  };

  const existingList = await db
    .select({ id: calendarList.id, selected: calendarList.selected })
    .from(calendarList)
    .where(
      and(
        eq(calendarList.connectionId, input.connectionId),
        eq(calendarList.externalCalendarId, snapshot.externalLayerId),
      ),
    )
    .limit(1);

  let row: { id: string; selected: boolean };
  if (existingList[0]) {
    await db.update(calendarList).set(listValues).where(eq(calendarList.id, existingList[0].id));
    row = existingList[0];
  } else {
    const inserted = await db
      .insert(calendarList)
      .values({
        userId: input.userId,
        connectionId: input.connectionId,
        externalCalendarId: snapshot.externalLayerId,
        ...listValues,
        selected: true,
        visibleByDefault: true,
      })
      .returning({ id: calendarList.id, selected: calendarList.selected });
    const insertedRow = inserted[0];
    if (!insertedRow) throw new Error('calendar list insert returned no row');
    row = insertedRow;
  }

  const layerValues = {
    title: listValues.title,
    description: listValues.description,
    timezone: listValues.timezone,
    color: listValues.color,
    accessRole: listValues.accessRole,
    primary: listValues.primary,
    editableCore: snapshot.editableCore,
    lastSyncedAt: input.now,
    lastError: null,
  };
  const existingLayer = await db
    .select({ id: calendarLayer.id, syncToken: calendarLayer.syncToken })
    .from(calendarLayer)
    .where(eq(calendarLayer.id, row.id))
    .limit(1);

  let syncToken: string | null = null;
  if (existingLayer[0]) {
    await db.update(calendarLayer).set(layerValues).where(eq(calendarLayer.id, row.id));
    syncToken = existingLayer[0].syncToken;
  } else {
    await db.insert(calendarLayer).values({
      id: row.id,
      userId: input.userId,
      connectionId: input.connectionId,
      provider: input.provider,
      sourceKind: 'provider_calendar',
      externalLayerId: snapshot.externalLayerId,
      ...layerValues,
      selected: true,
      visibleByDefault: true,
    });
  }

  return { id: row.id, selected: row.selected, syncToken };
}

/**
 * Archive both the legacy `calendar_event` row and the layered `calendar_item` row
 * (they share an id, per the Task 1 backfill) for one provider item — used both by an
 * inbound cancelled/tombstone pull and by the write outbox's applied delete.
 *
 * @remarks
 * Never touches `title` — cancelled/tombstone payloads may carry an empty title, and
 * overwriting a known title with `''` on archive would be a regression. The ONE archive
 * implementation both callers share, per this task's binding rules.
 */
export async function archiveProviderItem(db: Database, itemId: string, now: Date): Promise<void> {
  await db
    .update(calendarEvent)
    .set({ archivedAt: now, status: 'cancelled' })
    .where(eq(calendarEvent.id, itemId));
  await db
    .update(calendarItem)
    .set({ archivedAt: now, status: 'cancelled' })
    .where(eq(calendarItem.id, itemId));
}

/**
 * Dual-write one synced provider item: `calendar_event` (legacy) then `calendar_item`
 * (reusing the event row's id, per the Task 1 backfill). A cancelled snapshot archives
 * both rows via {@link archiveProviderItem}. A non-cancelled upsert always resets
 * `conflict` to `null` and `syncState` to `'clean'` — the provider is the source of
 * truth here, so an inbound sync overwriting an item's fields resolves any prior local
 * write conflict on it (the ONLY other path that clears `conflict` is a successful
 * outbox retry; see `calendar-outbox.ts`).
 */
async function upsertProviderItem(
  db: Database,
  input: {
    userId: string;
    connectionId: string;
    layerId: string;
    externalCalendarId: string;
    provider: CalendarProvider;
    snapshot: ProviderItemSnapshot;
    now: Date;
  },
): Promise<'created' | 'updated' | 'archived' | 'skipped'> {
  const { snapshot } = input;
  const existing = await db
    .select({ id: calendarEvent.id })
    .from(calendarEvent)
    .where(
      and(
        eq(calendarEvent.calendarId, input.layerId),
        eq(calendarEvent.externalEventId, snapshot.externalEventId),
      ),
    )
    .limit(1);

  if (snapshot.cancelled) {
    if (!existing[0]) return 'skipped';
    await archiveProviderItem(db, existing[0].id, input.now);
    return 'archived';
  }

  // Documented fallback (repo lint permits a documented `||`/`??` default): an adapter may
  // report an empty title for a real (non-cancelled) event; the legacy sync always showed
  // a placeholder rather than a blank row.
  const title = snapshot.title.length > 0 ? snapshot.title : '(no title)';
  const eventValues = {
    status: snapshot.status,
    title,
    description: snapshot.description,
    location: snapshot.location,
    htmlLink: snapshot.htmlLink,
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    allDayStartDate: snapshot.allDayStartDate,
    allDayEndDate: snapshot.allDayEndDate,
    organizer: snapshot.organizer,
    attendees: snapshot.attendees,
    updatedExternalAt: snapshot.updatedExternalAt,
    etag: snapshot.externalEtag,
    recurringEventId: snapshot.recurringEventId,
    archivedAt: null,
  };

  let itemId: string;
  let outcome: 'created' | 'updated';
  if (existing[0]) {
    await db.update(calendarEvent).set(eventValues).where(eq(calendarEvent.id, existing[0].id));
    itemId = existing[0].id;
    outcome = 'updated';
  } else {
    const inserted = await db
      .insert(calendarEvent)
      .values({
        userId: input.userId,
        connectionId: input.connectionId,
        calendarId: input.layerId,
        externalCalendarId: input.externalCalendarId,
        externalEventId: snapshot.externalEventId,
        ...eventValues,
      })
      .returning({ id: calendarEvent.id });
    const row = inserted[0];
    if (!row) throw new Error('calendar event insert returned no row');
    itemId = row.id;
    outcome = 'created';
  }

  const itemValues = {
    layerId: input.layerId,
    connectionId: input.connectionId,
    kind: 'provider_event',
    provider: input.provider,
    externalCalendarId: input.externalCalendarId,
    externalEventId: snapshot.externalEventId,
    recurringEventId: snapshot.recurringEventId,
    status: snapshot.status,
    title,
    description: snapshot.description,
    location: snapshot.location,
    htmlLink: snapshot.htmlLink,
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    allDayStartDate: snapshot.allDayStartDate,
    allDayEndDate: snapshot.allDayEndDate,
    organizer: snapshot.organizer,
    attendees: snapshot.attendees,
    providerRaw: snapshot.raw,
    permissions: snapshot.permissions,
    updatedExternalAt: snapshot.updatedExternalAt,
    externalEtag: snapshot.externalEtag,
    syncState: 'clean',
    // The provider wins on inbound sync: any prior unresolved write conflict on this item
    // is superseded by the fresh provider snapshot (see this function's remarks).
    conflict: null,
    archivedAt: null,
  };
  const existingItem = await db
    .select({ id: calendarItem.id })
    .from(calendarItem)
    .where(eq(calendarItem.id, itemId))
    .limit(1);
  if (existingItem[0]) {
    await db.update(calendarItem).set(itemValues).where(eq(calendarItem.id, itemId));
  } else {
    await db.insert(calendarItem).values({ id: itemId, userId: input.userId, ...itemValues });
  }

  return outcome;
}

/** Identifies one layer to sync, independent of which caller (full sweep or a single hint) got here. */
interface LayerSyncTarget {
  readonly id: string;
  readonly externalLayerId: string;
  readonly syncToken: string | null;
}

/** The item-level tally of one {@link runLayerSync} attempt. */
interface LayerSyncTally {
  readonly created: number;
  readonly updated: number;
  readonly archived: number;
  readonly errors: readonly string[];
}

/**
 * Claim one layer's sync lease, pull + apply its changes, persist the new cursor, and
 * release the lease in a `finally` — the ONE per-layer sync implementation shared by the
 * full connection sweep ({@link syncCalendarConnections}) and a single-layer push-hint
 * sync ({@link syncSingleLayer}), per this module's "no duplicate implementations" rule.
 *
 * @returns `null` when another run already holds the layer's lease (skipped, not an
 *   error); otherwise the item-level tally for this attempt.
 */
async function runLayerSync(
  db: Database,
  input: {
    readonly userId: string;
    readonly connectionId: string;
    readonly provider: CalendarProvider;
    readonly adapter: CalendarProviderAdapter;
    readonly credentials: CalendarProviderCredentials;
    readonly target: LayerSyncTarget;
    readonly editableCore: boolean;
    readonly now: Date;
  },
): Promise<LayerSyncTally | null> {
  const claimed = await claimLayerLease(db, input.target.id, input.now);
  if (!claimed) return null;

  const window = windowBounds(input.now);
  const tally = { created: 0, updated: 0, archived: 0, errors: [] as string[] };
  try {
    let pull = await input.adapter.pullChanges({
      credentials: input.credentials,
      externalLayerId: input.target.externalLayerId,
      cursor: input.target.syncToken,
      window,
      layerEditableCore: input.editableCore,
    });
    if (pull.cursorInvalid) {
      pull = await input.adapter.pullChanges({
        credentials: input.credentials,
        externalLayerId: input.target.externalLayerId,
        cursor: null,
        window,
        layerEditableCore: input.editableCore,
      });
    }

    for (const itemSnapshot of pull.items) {
      const outcome = await upsertProviderItem(db, {
        userId: input.userId,
        connectionId: input.connectionId,
        layerId: input.target.id,
        externalCalendarId: input.target.externalLayerId,
        provider: input.provider,
        snapshot: itemSnapshot,
        now: input.now,
      });
      if (outcome === 'created') tally.created += 1;
      else if (outcome === 'updated') tally.updated += 1;
      else if (outcome === 'archived') tally.archived += 1;
    }

    await db
      .update(calendarLayer)
      .set({ syncToken: pull.nextCursor, lastSyncedAt: input.now, lastError: null })
      .where(eq(calendarLayer.id, input.target.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calendar layer sync failed';
    await db
      .update(calendarLayer)
      .set({ lastError: message })
      .where(eq(calendarLayer.id, input.target.id));
    tally.errors.push(`${input.target.externalLayerId}: ${message}`);
  } finally {
    await releaseLayerLease(db, input.target.id);
  }
  return tally;
}

/** Options for {@link syncCalendarConnections}. */
export interface SyncCalendarConnectionsOptions {
  readonly userId: string;
  /** Reference time for the run; defaults to `new Date()`. Threaded through for deterministic tests. */
  readonly now?: Date;
  /**
   * The provider → sync-module map to run. Always assembled OUTSIDE the engine (the
   * production map lives in `calendar-sync-modules.ts`, passed by the route) so this
   * module never imports any adapter — that is what keeps the engine provider-free and
   * lets neutrality tests drive it with a fake {@link CalendarProviderSyncModule}.
   */
  readonly adapters: Partial<Record<CalendarProvider, CalendarProviderSyncModule>>;
}

/**
 * Sync every linked calendar account/layer/item for one user, across every provider with
 * a registered {@link CalendarProviderSyncModule}.
 *
 * @remarks
 * Per connection: resolve credentials (a failure marks the connection `reauth_required`
 * when the module signals {@link CalendarReauthRequiredError}, else `error`, tallies the
 * failure, and moves on to the next connection — a single account never aborts the whole
 * run), capture + persist scope state, list layers (dual-write, always), then for each
 * SELECTED layer: claim its lease (an already-leased layer is skipped silently — the lease
 * exists for overlap-prevention, not reporting), pull (full or incremental; a
 * `cursorInvalid` result triggers one immediate full re-pull under the same lease), apply
 * items (dual-write), persist the new cursor, and release the lease in a `finally` so a
 * throw mid-pull never wedges the layer.
 */
export async function syncCalendarConnections(
  db: Database,
  opts: SyncCalendarConnectionsOptions,
): Promise<z.input<typeof CalendarSyncResultOut>> {
  const now = opts.now ?? new Date();

  const counts = {
    connections: 0,
    calendars: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    eventsDeleted: 0,
    errors: [] as string[],
    layers: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsArchived: 0,
    // This pull-only engine never touches the write outbox; the `/me/calendar/sync`
    // route folds in real `writesApplied`/`writesPending`/`conflicts` counts by draining
    // the outbox (`calendar-outbox.ts`) after this function returns.
    writesApplied: 0,
    writesPending: 0,
    conflicts: 0,
  };

  for (const [providerKey, mod] of Object.entries(opts.adapters)) {
    const provider = CalendarProvider.parse(providerKey);
    const discovered = await mod.discoverConnections({ db, userId: opts.userId });

    for (const connection of discovered) {
      const existingConnectionId = await findConnectionId(db, {
        userId: opts.userId,
        provider,
        externalAccountId: connection.externalAccountId,
      });

      try {
        const credentials = await mod.resolveCredentials(connection);
        const scopeState = mod.captureScopeState(connection, now);
        const connectionId = await upsertConnection(db, {
          userId: opts.userId,
          provider,
          externalAccountId: connection.externalAccountId,
          accountEmail: connection.accountEmail,
          accountName: connection.accountName,
          accountPictureUrl: connection.accountPictureUrl,
          scopeState,
          now,
        });
        counts.connections += 1;

        const layerSnapshots = await mod.adapter.listLayers({ credentials });
        for (const snapshot of layerSnapshots) {
          const layerRow = await upsertProviderLayer(db, {
            userId: opts.userId,
            connectionId,
            provider,
            snapshot,
            now,
          });
          counts.calendars += 1;
          counts.layers += 1;
          if (!layerRow.selected) continue;

          const result = await runLayerSync(db, {
            userId: opts.userId,
            connectionId,
            provider,
            adapter: mod.adapter,
            credentials,
            target: {
              id: layerRow.id,
              externalLayerId: snapshot.externalLayerId,
              syncToken: layerRow.syncToken,
            },
            editableCore: snapshot.editableCore,
            now,
          });
          if (result === null) continue; // lease held elsewhere — skip silently
          counts.eventsCreated += result.created;
          counts.itemsCreated += result.created;
          counts.eventsUpdated += result.updated;
          counts.itemsUpdated += result.updated;
          counts.eventsDeleted += result.archived;
          counts.itemsArchived += result.archived;
          counts.errors.push(...result.errors);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Calendar sync failed';
        counts.errors.push(`${connection.externalAccountId}: ${message}`);
        if (existingConnectionId !== null) {
          const needsReauth = err instanceof CalendarReauthRequiredError;
          await db
            .update(calendarConnection)
            .set({ status: needsReauth ? 'reauth_required' : 'error', lastError: message })
            .where(eq(calendarConnection.id, existingConnectionId));
        }
      }
    }
  }

  return counts;
}

/** Options for {@link syncSingleLayer}. */
export interface SyncSingleLayerOptions {
  readonly userId: string;
  readonly layerId: string;
  /** Same provider → sync-module map {@link syncCalendarConnections} takes. */
  readonly adapters: Partial<Record<CalendarProvider, CalendarProviderSyncModule>>;
  /** Reference time; defaults to `new Date()`. Threaded through for deterministic tests. */
  readonly now?: Date;
}

/** The item-level tally of one {@link syncSingleLayer} attempt. */
export interface SyncSingleLayerResult {
  readonly created: number;
  readonly updated: number;
  readonly archived: number;
}

const NOOP_LAYER_SYNC_RESULT: SyncSingleLayerResult = { created: 0, updated: 0, archived: 0 };

/**
 * Sync ONE provider-backed layer, bypassing full connection discovery — the bounded,
 * fast path a push-notification hint (`calendar-webhook.ts`) or a targeted re-sync
 * triggers, sharing {@link runLayerSync} with the full sweep so there is exactly one
 * per-layer sync implementation.
 *
 * @remarks
 * A no-op (zero tally, never throws) when: the layer does not exist, is not owned by
 * `userId`, is not provider-backed (no `connectionId`/`externalLayerId` — native blocks,
 * task timeboxes, availability), has no registered sync module for its provider, the
 * linked account can no longer be found, or credential resolution fails (needs reauth) —
 * every one of these is "nothing safe to do right now", not a caller error, so a webhook
 * handler can call this unconditionally and always return 200.
 */
export async function syncSingleLayer(
  db: Database,
  opts: SyncSingleLayerOptions,
): Promise<SyncSingleLayerResult> {
  const now = opts.now ?? new Date();

  const rows = await db
    .select({ layer: calendarLayer, connection: calendarConnection })
    .from(calendarLayer)
    .innerJoin(calendarConnection, eq(calendarConnection.id, calendarLayer.connectionId))
    .where(and(eq(calendarLayer.id, opts.layerId), eq(calendarLayer.userId, opts.userId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return NOOP_LAYER_SYNC_RESULT;
  if (row.layer.externalLayerId === null) return NOOP_LAYER_SYNC_RESULT;

  const provider = CalendarProvider.parse(row.layer.provider);
  const mod = opts.adapters[provider];
  if (mod === undefined) return NOOP_LAYER_SYNC_RESULT;

  const discovered = await mod.discoverConnections({ db, userId: opts.userId });
  const match = discovered.find((d) => d.externalAccountId === row.connection.externalAccountId);
  if (match === undefined) return NOOP_LAYER_SYNC_RESULT;

  let credentials: CalendarProviderCredentials;
  try {
    credentials = await mod.resolveCredentials(match);
  } catch {
    return NOOP_LAYER_SYNC_RESULT;
  }

  const result = await runLayerSync(db, {
    userId: opts.userId,
    connectionId: row.connection.id,
    provider,
    adapter: mod.adapter,
    credentials,
    target: {
      id: row.layer.id,
      externalLayerId: row.layer.externalLayerId,
      syncToken: row.layer.syncToken,
    },
    editableCore: row.layer.editableCore,
    now,
  });
  if (result === null) return NOOP_LAYER_SYNC_RESULT; // a full sweep already holds this layer's lease

  return { created: result.created, updated: result.updated, archived: result.archived };
}

/** A layer's watch renews when it expires within this long — padding for scheduler jitter. */
const WATCH_RENEWAL_WINDOW_MS = 30 * 60 * 1000;

/** Options for {@link registerOrRenewWatches}. */
export interface RegisterOrRenewWatchesOptions {
  readonly userId: string;
  readonly now: Date;
  /** Same provider → sync-module map {@link syncCalendarConnections} takes. */
  readonly adapters: Partial<Record<CalendarProvider, CalendarProviderSyncModule>>;
  /**
   * Resolve the registered push-notification callback URL for one provider, or `null`/
   * empty when unconfigured. Reading env belongs to the caller (`calendar-sync-sweep.ts`),
   * not this provider-free engine — see this module's file doc.
   */
  readonly callbackUrlFor: (provider: CalendarProvider) => string | null;
}

/** The tally of one {@link registerOrRenewWatches} pass. */
export interface WatchRegistrationTally {
  /** Watch channels newly registered or renewed (Google `startWatch` calls that succeeded). */
  readonly registered: number;
}

/**
 * Register or renew a push-notification watch channel for every SELECTED layer whose
 * adapter supports push, across every provider with a registered
 * {@link CalendarProviderSyncModule}.
 *
 * @remarks
 * Per provider: skipped entirely (no adapter calls, zero tally) when the adapter has no
 * `startWatch` (checked via `typeof === 'function'`, never assumed) OR
 * `callbackUrlFor(provider)` returns an empty/absent URL — the explicit, no-hidden-default
 * config gate for push hints. Per connection: a credential-resolution failure (needs
 * reauth) skips that connection's layers entirely, touching nothing. Per layer: a watch is
 * (re)registered when it was never registered, has no expiry, or expires within
 * {@link WATCH_RENEWAL_WINDOW_MS}; a layer with a fresh watch is left untouched (zero
 * adapter calls for it).
 */
export async function registerOrRenewWatches(
  db: Database,
  opts: RegisterOrRenewWatchesOptions,
): Promise<WatchRegistrationTally> {
  let registered = 0;

  for (const [providerKey, mod] of Object.entries(opts.adapters)) {
    const provider = CalendarProvider.parse(providerKey);
    const startWatch = mod.adapter.startWatch;
    if (typeof startWatch !== 'function') continue;

    const callbackUrl = opts.callbackUrlFor(provider);
    if (!callbackUrl) continue;

    const discovered = await mod.discoverConnections({ db, userId: opts.userId });
    for (const connection of discovered) {
      const connectionId = await findConnectionId(db, {
        userId: opts.userId,
        provider,
        externalAccountId: connection.externalAccountId,
      });
      if (connectionId === null) continue; // never synced yet — no layers to register

      let credentials: CalendarProviderCredentials;
      try {
        credentials = await mod.resolveCredentials(connection);
      } catch {
        continue; // needs reauth — do not touch this connection's layers
      }

      const layers = await db
        .select({
          id: calendarLayer.id,
          externalLayerId: calendarLayer.externalLayerId,
          watchExpiresAt: calendarLayer.watchExpiresAt,
          watchRegisteredAt: calendarLayer.watchRegisteredAt,
        })
        .from(calendarLayer)
        .where(and(eq(calendarLayer.connectionId, connectionId), eq(calendarLayer.selected, true)));

      for (const layer of layers) {
        if (layer.externalLayerId === null) continue;
        const dueForRegistration =
          layer.watchRegisteredAt === null ||
          layer.watchExpiresAt === null ||
          layer.watchExpiresAt.getTime() - opts.now.getTime() <= WATCH_RENEWAL_WINDOW_MS;
        if (!dueForRegistration) continue;

        const watch = await startWatch({
          credentials,
          externalLayerId: layer.externalLayerId,
          callbackUrl,
        });
        await db
          .update(calendarLayer)
          .set({
            watchChannelId: watch.channelId,
            watchResourceId: watch.resourceId,
            watchToken: watch.token,
            watchExpiresAt: watch.expiresAt,
            watchRegisteredAt: opts.now,
          })
          .where(eq(calendarLayer.id, layer.id));
        registered += 1;
      }
    }
  }

  return { registered };
}
