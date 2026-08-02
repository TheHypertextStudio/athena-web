'use client';

/**
 * `calendar/calendar-layer-panel` — the calendar's layer visibility panel.
 *
 * @remarks
 * One row per {@link CalendarLayerOut}: a visibility checkbox, its color swatch, an optional inline
 * kind glyph, the title, and one line of supporting context (provider, sync recency, and — for a
 * calendar that arrives on more than one linked account — which account already shows it). Rows are
 * grouped under the account that owns them, because "which of my accounts is this from?" is the
 * question this panel exists to answer once more than one is linked.
 *
 * When {@link findDuplicateCalendarLayers} finds the same calendar arriving twice, the panel offers
 * a single **Hide duplicates** action. That action is explicit and fully reversible: every row stays
 * in the list, still toggleable, and still says why it was considered redundant. Nothing is ever
 * auto-hidden — a calendar the person cannot see and was never told about is precisely the failure
 * the connector-reliability rule forbids.
 *
 * A toggle is wrapped in {@link startViewTransition} (per this app's no-hard-swap rule) so the
 * timeline's item set reshapes rather than jumping when a layer's items appear or disappear;
 * {@link useUpdateLayerVisibility} is already optimistic, so no toggle waits on the network.
 */
import type { CalendarLayerOut } from '@docket/types';
import { Globe, Layers } from '@docket/ui/icons';
import { Badge, Button, Checkbox } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useMemo, useRef } from 'react';

import { relativeTime } from '@/components/settings/format-time';
import { useApiQuery } from '@/lib/query';
import { startViewTransition } from '@/lib/view-transition';

import { calendarSettingsDef } from './calendar-data';
import {
  type CalendarLayerDuplicateGroup,
  findDuplicateCalendarLayers,
  isHolidayLayer,
} from './calendar-layer-dedup';
import { useUpdateLayerVisibility } from './calendar-mutations';

/** How a row is marked redundant, and which account already shows the same calendar. */
interface LayerRedundancy {
  /** Whether this copy is the redundant one rather than the copy being kept. */
  readonly redundant: boolean;
  /** Human-readable owner of the copy being kept, e.g. `work@example.com`. */
  readonly keptOn: string;
  /** Whether the duplicate is a personal calendar surfacing on another account. */
  readonly crossAccountMailbox: boolean;
}

/** Register a per-layer "hide this" action so one bulk control can drive many rows. */
type RegisterHide = (layerId: string, hide: () => void) => () => void;

/** Props for {@link LayerRow}. */
interface LayerRowProps {
  /** The layer this row toggles/describes. */
  readonly layer: CalendarLayerOut;
  /** Duplicate context, when this layer renders a calendar that also arrives elsewhere. */
  readonly redundancy?: LayerRedundancy;
  /** Registry the row publishes its hide action into. */
  readonly registerHide: RegisterHide;
}

/** One layer's visibility row. */
function LayerRow({ layer, redundancy, registerHide }: LayerRowProps): JSX.Element {
  const update = useUpdateLayerVisibility(layer.id);
  const mutate = update.mutate;
  const holiday = isHolidayLayer(layer);

  useEffect(
    () =>
      registerHide(layer.id, () => {
        mutate({ selected: false });
      }),
    [layer.id, mutate, registerHide],
  );

  // Provenance only. The source name is dropped when it merely repeats the row's own title — a
  // Docket-native layer titled "Docket", sitting under a "Docket" group heading, used to print the
  // word three times in a 40px-tall row.
  const source = layer.provider === null ? 'Docket' : 'Google';
  const supporting = [
    source === layer.title.trim() ? null : source,
    layer.lastSyncedAt ? `synced ${relativeTime(layer.lastSyncedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="hover:bg-surface-container-high flex items-start gap-2 rounded-md px-1.5 py-1.5">
      <Checkbox
        checked={layer.selected}
        disabled={update.isPending}
        onChange={() => {
          startViewTransition(() => {
            mutate({ selected: !layer.selected });
          });
        }}
        aria-label={`Toggle ${layer.title} visibility`}
        className="mt-0.5"
      />
      <span
        aria-hidden="true"
        className="mt-[0.4375rem] size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: layer.color ?? 'var(--color-outline-variant)' }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-on-surface text-body-medium flex min-w-0 items-center gap-1.5">
          {holiday ? (
            <Globe aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
          ) : redundancy?.crossAccountMailbox === true ? (
            <Layers aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
          ) : null}
          <span className="truncate">{layer.title}</span>
        </span>
        {supporting ? (
          <span className="text-on-surface-variant text-body-small truncate">{supporting}</span>
        ) : null}
        {/*
          The duplicate note gets its own line rather than a third `·` clause. It is the fact that
          justifies the Hide duplicates action, and as a tail clause it was the first thing the row
          truncated away — leaving the action unexplained on exactly the accounts that need it.
        */}
        {redundancy?.redundant === true ? (
          <span className="text-on-surface-variant text-body-small flex min-w-0 items-center gap-1">
            <Layers aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">Also on {redundancy.keptOn}</span>
          </span>
        ) : null}
      </div>
      {!layer.editableCore ? (
        <Badge variant="secondary" className="mt-0.5 shrink-0 font-normal">
          Read-only
        </Badge>
      ) : null}
    </li>
  );
}

/** One account's worth of layers, in render order. */
interface LayerAccountGroup {
  readonly id: string;
  readonly label: string;
  readonly layers: readonly CalendarLayerOut[];
}

/** Group layers under the account that supplies them, with Docket-native layers first. */
function groupLayersByAccount(
  layers: readonly CalendarLayerOut[],
  labelForConnection: (connectionId: string) => string,
): readonly LayerAccountGroup[] {
  const byConnection = new Map<string, CalendarLayerOut[]>();
  for (const layer of layers) {
    const id = layer.connectionId ?? '';
    const bucket = byConnection.get(id);
    if (bucket) bucket.push(layer);
    else byConnection.set(id, [layer]);
  }
  return [...byConnection.entries()]
    .map(([id, grouped]) => ({
      id,
      label: id === '' ? 'Docket' : labelForConnection(id),
      layers: grouped,
    }))
    .sort((left, right) => {
      if (left.id === '') return -1;
      if (right.id === '') return 1;
      return left.label.localeCompare(right.label);
    });
}

/**
 * Whether a group's heading would only repeat its single row's title.
 *
 * @param group - One account's worth of layers.
 * @returns `true` when the group holds exactly one layer named the same as the group.
 */
function onlyRowRepeatsLabel(group: LayerAccountGroup): boolean {
  return group.layers.length === 1 && group.layers[0]?.title.trim() === group.label;
}

/** Map every redundant/kept layer id to the context its row should show. */
function redundancyByLayerId(
  groups: readonly CalendarLayerDuplicateGroup[],
  labelForConnection: (connectionId: string) => string,
): ReadonlyMap<string, LayerRedundancy> {
  const context = new Map<string, LayerRedundancy>();
  for (const group of groups) {
    const keptOn =
      group.keep.connectionId === null ? 'Docket' : labelForConnection(group.keep.connectionId);
    const crossAccountMailbox = group.reason === 'other_account_primary';
    context.set(group.keep.id, { redundant: false, keptOn, crossAccountMailbox });
    for (const layer of group.redundant) {
      context.set(layer.id, { redundant: true, keptOn, crossAccountMailbox });
    }
  }
  return context;
}

/** Props for {@link CalendarLayerPanel}. */
export interface CalendarLayerPanelProps {
  /** Every calendar layer for the signed-in user, selected or not. */
  layers: readonly CalendarLayerOut[];
}

/**
 * The layer visibility panel, grouped by account and aware of cross-account duplicates.
 *
 * @remarks
 * Reads linked accounts through {@link calendarSettingsDef}, which shares its query key with the
 * settings surface — so this is a warm-cache read, not a second fetch, and a failed read simply
 * degrades to ungrouped rows plus the duplicate rules that need no account data.
 *
 * @param props - The full layer list; nothing else is required to render.
 * @returns The panel, or a single-line note when no layers exist yet.
 */
export default function CalendarLayerPanel({ layers }: CalendarLayerPanelProps): JSX.Element {
  const settings = useApiQuery(calendarSettingsDef());
  const connections = useMemo(() => settings.data?.connections ?? [], [settings.data]);
  const hideActions = useRef(new Map<string, () => void>());
  const registerHide = useCallback<RegisterHide>((layerId, hide) => {
    hideActions.current.set(layerId, hide);
    return () => {
      hideActions.current.delete(layerId);
    };
  }, []);
  const labelForConnection = useCallback(
    (connectionId: string): string => {
      const connection = connections.find((candidate) => candidate.id === connectionId);
      return connection?.accountEmail ?? connection?.accountName ?? 'Linked account';
    },
    [connections],
  );
  const duplicates = useMemo(
    () => findDuplicateCalendarLayers(layers, connections),
    [connections, layers],
  );
  const redundancy = useMemo(
    () => redundancyByLayerId(duplicates, labelForConnection),
    [duplicates, labelForConnection],
  );
  const groups = useMemo(
    () => groupLayersByAccount(layers, labelForConnection),
    [labelForConnection, layers],
  );
  const hideableIds = useMemo(
    () =>
      duplicates.flatMap((group) =>
        group.redundant.filter((layer) => layer.selected).map((layer) => layer.id),
      ),
    [duplicates],
  );

  if (layers.length === 0) {
    return (
      <p className="text-on-surface-variant text-body-small">
        No calendar layers yet. Link a Google account or create a native block to get one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {hideableIds.length > 0 ? (
        <div className="bg-surface-container-high flex items-center gap-2 rounded-md px-1.5 py-1.5">
          <p className="text-on-surface-variant text-body-small min-w-0 flex-1">
            {hideableIds.length === 1
              ? '1 duplicate calendar across accounts'
              : `${String(hideableIds.length)} duplicate calendars across accounts`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => {
              // Explicit and reversible: this only unticks rows that stay right here, each still
              // labelled with the account that keeps showing the same calendar.
              startViewTransition(() => {
                for (const id of hideableIds) hideActions.current.get(id)?.();
              });
            }}
          >
            Hide duplicates
          </Button>
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          {/*
            The account heading is dropped when it would only restate its one row — the native
            "Docket" group holding the single "Docket" layer. A heading exists to tell two accounts
            apart, so one that names the same thing as the row beneath it is pure repetition.
          */}
          {groups.length > 1 && !onlyRowRepeatsLabel(group) ? (
            <h3 className="text-on-surface-variant text-label-medium truncate px-1.5 pt-1">
              {group.label}
            </h3>
          ) : null}
          <ul
            aria-label={groups.length > 1 ? `Calendar layers · ${group.label}` : 'Calendar layers'}
            className="flex flex-col gap-0.5"
          >
            {group.layers.map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                redundancy={redundancy.get(layer.id)}
                registerHide={registerHide}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
