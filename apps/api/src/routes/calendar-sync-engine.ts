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
 * adapter contract (declared here, implemented per-provider) are the outbound half —
 * push-notification subscriptions and cron draining are still a later phase. This module
 * itself stays pull-only and provider-free: it declares the push/delete contract types
 * so adapters and the outbox agree on a shape, but never calls them.
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

/**
 * The provider-neutral pull + push contract every adapter implements. Push-notification
 * `watch` subscriptions are NOT part of this contract yet — that (plus cron draining of
 * the outbox) is a later phase; adding a stub method now would violate the no-stubs rule.
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
  const window = windowBounds(now);

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

          const claimed = await claimLayerLease(db, layerRow.id, now);
          if (!claimed) continue;

          try {
            let pull = await mod.adapter.pullChanges({
              credentials,
              externalLayerId: snapshot.externalLayerId,
              cursor: layerRow.syncToken,
              window,
              layerEditableCore: snapshot.editableCore,
            });
            if (pull.cursorInvalid) {
              pull = await mod.adapter.pullChanges({
                credentials,
                externalLayerId: snapshot.externalLayerId,
                cursor: null,
                window,
                layerEditableCore: snapshot.editableCore,
              });
            }

            for (const itemSnapshot of pull.items) {
              const outcome = await upsertProviderItem(db, {
                userId: opts.userId,
                connectionId,
                layerId: layerRow.id,
                externalCalendarId: snapshot.externalLayerId,
                provider,
                snapshot: itemSnapshot,
                now,
              });
              if (outcome === 'created') {
                counts.eventsCreated += 1;
                counts.itemsCreated += 1;
              } else if (outcome === 'updated') {
                counts.eventsUpdated += 1;
                counts.itemsUpdated += 1;
              } else if (outcome === 'archived') {
                counts.eventsDeleted += 1;
                counts.itemsArchived += 1;
              }
            }

            await db
              .update(calendarLayer)
              .set({ syncToken: pull.nextCursor, lastSyncedAt: now, lastError: null })
              .where(eq(calendarLayer.id, layerRow.id));
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Calendar layer sync failed';
            await db
              .update(calendarLayer)
              .set({ lastError: message })
              .where(eq(calendarLayer.id, layerRow.id));
            counts.errors.push(`${snapshot.externalLayerId}: ${message}`);
          } finally {
            await releaseLayerLease(db, layerRow.id);
          }
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
