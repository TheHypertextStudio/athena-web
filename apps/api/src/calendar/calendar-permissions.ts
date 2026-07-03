/**
 * `@docket/api` — provider-agnostic calendar-item permission resolution.
 *
 * @remarks
 * V1 write scopes have not landed yet (native-block CRUD, task-link mutations, and the
 * provider write outbox are later phases), so this module is deliberately conservative:
 * every branch that isn't proven safe resolves to read-only with a specific reason. Once
 * the write outbox lands, `provider_event` resolution can start trusting adapter-emitted
 * permission snapshots for more cases.
 */
import type { calendarConnection, calendarItem, calendarLayer } from '@docket/db';
import {
  CalendarItemKind,
  type CalendarItemPermission,
  CalendarItemSyncState,
} from '@docket/types';

/** The database row shape backing a calendar layer. */
export type CalendarLayerRow = typeof calendarLayer.$inferSelect;
/** The database row shape backing a calendar item. */
export type CalendarItemRow = typeof calendarItem.$inferSelect;
/** The database row shape backing a calendar connection. */
export type CalendarConnectionRow = typeof calendarConnection.$inferSelect;

/**
 * The conservative, context-free permission default for a calendar-item kind: editable
 * only for `native_block`, read-only (reason `'kind'`) for everything else.
 *
 * @remarks
 * Used both as the terminal branch of {@link resolveItemPermissions} for kinds that are
 * never editable via calendar item routes, and as the serializer's fallback when a raw
 * row's stored `permissions` snapshot is `null` and no layer/connection context is
 * available to resolve a more specific reason.
 */
export function defaultItemPermissionsForKind(kind: CalendarItemKind): CalendarItemPermission {
  if (kind === 'native_block') {
    return { canEditCore: true, canDelete: true, readOnlyReason: null };
  }
  return { canEditCore: false, canDelete: false, readOnlyReason: 'kind' };
}

/**
 * Resolve a calendar item's normalized edit/delete permissions for the viewer.
 *
 * @remarks
 * `native_block` items are always editable (Docket owns them outright). `task_timebox`
 * and `availability_block` items are never editable via calendar item routes — they are
 * derived views onto other domains. `provider_event` items are editable only when the
 * connection's granted OAuth scopes include calendar write, the layer itself allows
 * core edits, AND the item's adapter-emitted permission snapshot (when present) does not
 * deny it; until the sync engine writes real snapshots that field is always `null`, which
 * — once scope and layer checks pass — resolves to fully editable (no snapshot means no
 * denial). Finally, an item flagged `conflict` is force-downgraded to read-only
 * regardless of kind, since an unresolved local/provider divergence must not be edited
 * further until a human resolves it.
 *
 * @param input.item - The calendar item row.
 * @param input.layer - The item's owning layer row, or `null` if it could not be loaded.
 * @param input.connection - The item's provider connection row, or `null` for
 *   connection-less items (native/derived kinds).
 */
export function resolveItemPermissions(input: {
  item: CalendarItemRow;
  layer: CalendarLayerRow | null;
  connection: CalendarConnectionRow | null;
}): CalendarItemPermission {
  const { item, layer, connection } = input;
  const kind = CalendarItemKind.parse(item.kind);
  const syncState = CalendarItemSyncState.parse(item.syncState);

  let base: CalendarItemPermission;
  if (kind === 'native_block' || kind === 'task_timebox' || kind === 'availability_block') {
    base = defaultItemPermissionsForKind(kind);
  } else {
    // kind === 'provider_event' (the only remaining case).
    const hasWriteScope = connection !== null && connection.scopeState?.calendarWrite === true;
    const layerEditable = layer?.editableCore === true;
    if (!hasWriteScope) {
      base = { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' };
    } else if (!layerEditable) {
      base = { canEditCore: false, canDelete: false, readOnlyReason: 'layer_access_role' };
    } else if (item.permissions !== null) {
      base = item.permissions;
    } else {
      base = { canEditCore: true, canDelete: true, readOnlyReason: null };
    }
  }

  if (syncState === 'conflict') {
    return { canEditCore: false, canDelete: false, readOnlyReason: 'conflict' };
  }
  return base;
}
