'use client';

/**
 * `calendar/calendar-layer-panel` — the calendar's layer visibility panel.
 *
 * @remarks
 * One row per *calendar*: a visibility checkbox, its color swatch, an optional inline
 * kind glyph, the title, and one line of supporting context (provider, sync recency, and — for a
 * calendar that arrives on more than one linked account — which account already shows it). Rows are
 * grouped under the account that owns them, because "which of my accounts is this from?" is the
 * question this panel exists to answer once more than one is linked.
 *
 * When {@link findDuplicateCalendarLayers} finds the same calendar arriving on more than one linked
 * account, the panel lists that calendar **once**, on a row attributed to every account it came from
 * ("On work@example.com and ada@personal.com"). Ticking that row ticks every copy, so visibility and
 * what is on the grid stay in step. Listing a calendar twice was the complaint: "Surely there's some
 * way to deduplicate shit like holiday calendars or personal calendars appearing on work accounts."
 *
 * Collapsing is never a disappearance. The row says how many accounts it stands for, and a single
 * **Show each copy** disclosure expands the group back into one row per account, each independently
 * toggleable. A calendar the person cannot see and was never told about is precisely the failure the
 * connector-reliability rule forbids — so the fact is on the row, and the way back is one click.
 *
 * A toggle is wrapped in {@link startViewTransition} (per this app's no-hard-swap rule) so the
 * timeline's item set reshapes rather than jumping when a layer's items appear or disappear;
 * {@link useUpdateLayerGroupVisibility} is already optimistic, so no toggle waits on the network.
 */
import type { CalendarLayerOut } from '@docket/types';
import { Globe, Layers } from '@docket/ui/icons';
import { Badge, Button, Checkbox } from '@docket/ui/primitives';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { relativeTime } from '@/components/settings/format-time';
import { useApiQuery } from '@/lib/query';
import { startViewTransition } from '@/lib/view-transition';

import { calendarSettingsDef } from './calendar-data';
import {
  type CalendarLayerDuplicateGroup,
  findDuplicateCalendarLayers,
  isHolidayLayer,
} from './calendar-layer-dedup';
import { useUpdateLayerGroupVisibility } from './calendar-mutations';

/** The accounts one collapsed row stands for, in the order they are named on it. */
interface LayerRedundancy {
  /** Distinct human-readable accounts this calendar arrives on, e.g. `work@example.com`. */
  readonly accounts: readonly string[];
  /** How many distinct linked accounts it actually arrives on. */
  readonly accountCount: number;
  /** Whether the duplicate is a personal calendar surfacing on another account. */
  readonly crossAccountMailbox: boolean;
}

/**
 * The one-line attribution a collapsed row prints, or `null` when there is nothing to attribute.
 *
 * @remarks
 * Names the accounts when they can be told apart, and falls back to the honest count when they
 * cannot — a failed settings read leaves every connection resolving to the same generic label, and
 * printing "On Linked account and Linked account" would be worse than saying nothing.
 *
 * @param redundancy - The row's duplicate context, if it has one.
 * @returns The clause to render after "On ", or `null`.
 */
function attributionLine(redundancy: LayerRedundancy | undefined): string | null {
  if (redundancy === undefined || redundancy.accountCount < 2) return null;
  const { accounts, accountCount } = redundancy;
  if (accounts.length < accountCount) return `${String(accountCount)} linked accounts`;
  return `${accounts.slice(0, -1).join(', ')} and ${String(accounts.at(-1))}`;
}

/** Props for {@link LayerRow}. */
interface LayerRowProps {
  /** The layer this row toggles/describes. */
  readonly layer: CalendarLayerOut;
  /** Duplicate context, when this row stands for the same calendar on several accounts. */
  readonly redundancy?: LayerRedundancy | undefined;
  /**
   * Every layer id this one row governs.
   *
   * @remarks
   * `[layer.id]` for an ordinary calendar; the whole duplicate group when the row stands for a
   * calendar that arrives on more than one account, so one tick moves every copy.
   */
  readonly layerIds: readonly string[];
}

/**
 * One calendar's visibility row.
 *
 * @remarks
 * A row is a *calendar*, not a layer record: when the same calendar arrives on two linked accounts
 * this is the single row for it, its checkbox drives every copy, and {@link LayerRedundancy} names
 * every account underneath.
 *
 * @param props - The {@link LayerRowProps}.
 * @returns The row.
 */
function LayerRow({ layer, redundancy, layerIds }: LayerRowProps): JSX.Element {
  const update = useUpdateLayerGroupVisibility(layerIds);
  const mutate = update.mutate;
  const holiday = isHolidayLayer(layer);

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
  const attribution = attributionLine(redundancy);

  return (
    <li className="hover:bg-surface-container-high flex items-start gap-2 rounded-md px-1.5 py-1.5">
      <Checkbox
        checked={layer.selected}
        disabled={update.isPending}
        onChange={() => {
          // One calendar, one decision: a row standing for three copies moves all three, or
          // unticking it would leave the same events on the grid from the other account.
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
          <span className="text-on-surface-variant text-body-medium truncate">{supporting}</span>
        ) : null}
        {/*
          The attribution gets its own line rather than a third `·` clause. It is the fact that
          justifies drawing one row where the API returned two, and as a tail clause it was the first
          thing the row truncated away — leaving the collapse unexplained on exactly the accounts
          that need it explained.
        */}
        {attribution ? (
          <span className="text-on-surface-variant text-body-medium flex min-w-0 items-center gap-1">
            <Layers aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">On {attribution}</span>
          </span>
        ) : null}
      </div>
      {!layer.editableCore ? (
        <Badge variant="secondary" className="mt-0.5 shrink-0">
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

/**
 * Map each surviving row to the accounts it stands for.
 *
 * @param groups - Duplicate groups from {@link findDuplicateCalendarLayers}.
 * @param labelForConnection - Resolve a connection id to the account's display label.
 * @returns Attribution keyed by the id of the copy that stays on the list.
 */
function redundancyByLayerId(
  groups: readonly CalendarLayerDuplicateGroup[],
  labelForConnection: (connectionId: string) => string,
): ReadonlyMap<string, LayerRedundancy> {
  const label = (layer: CalendarLayerOut): string =>
    layer.connectionId === null ? 'Docket' : labelForConnection(layer.connectionId);
  const context = new Map<string, LayerRedundancy>();
  for (const group of groups) {
    const members = [group.keep, ...group.redundant];
    context.set(group.keep.id, {
      accounts: [...new Set(members.map(label))],
      accountCount: new Set(members.map((entry) => entry.connectionId)).size,
      crossAccountMailbox: group.reason === 'other_account_primary',
    });
  }
  return context;
}

/** Props for {@link CalendarLayerPanel}. */
export interface CalendarLayerPanelProps {
  /** Every calendar layer for the signed-in user, selected or not. */
  layers: readonly CalendarLayerOut[];
}

/**
 * The layer visibility panel: one row per calendar, grouped by the account that supplies it.
 *
 * @remarks
 * Reads linked accounts through {@link calendarSettingsDef}, which shares its query key with the
 * settings surface — so this is a warm-cache read, not a second fetch, and a failed read simply
 * degrades to ungrouped rows plus the duplicate rules that need no account data.
 *
 * A calendar that arrives on more than one account is listed **once**, attributed to all of them.
 * `Show each copy` expands the collapse; nothing is hidden without the row saying so.
 *
 * @param props - The full layer list; nothing else is required to render.
 * @returns The panel, or a single-line note when no layers exist yet.
 */
export default function CalendarLayerPanel({ layers }: CalendarLayerPanelProps): JSX.Element {
  const settings = useApiQuery(calendarSettingsDef());
  const connections = useMemo(() => settings.data?.connections ?? [], [settings.data]);
  const [expandCopies, setExpandCopies] = useState(false);
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
  /** Ids the panel folds away while collapsed, keyed by the id of the row that stands for them. */
  const foldedByKeptId = useMemo(() => {
    const folded = new Map<string, readonly string[]>();
    for (const group of duplicates) {
      folded.set(
        group.keep.id,
        group.redundant.map((layer) => layer.id),
      );
    }
    return folded;
  }, [duplicates]);
  const foldedIds = useMemo(() => new Set([...foldedByKeptId.values()].flat()), [foldedByKeptId]);
  const visibleLayers = useMemo(
    () => (expandCopies ? layers : layers.filter((layer) => !foldedIds.has(layer.id))),
    [expandCopies, foldedIds, layers],
  );
  const groups = useMemo(
    () => groupLayersByAccount(visibleLayers, labelForConnection),
    [labelForConnection, visibleLayers],
  );
  if (layers.length === 0) {
    return (
      <p className="text-on-surface-variant text-body-medium">
        No calendar layers yet. Link a Google account or create a native block to get one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {foldedIds.size > 0 ? (
        <div className="bg-surface-container-high flex items-center gap-2 rounded-md px-1.5 py-1.5">
          <p className="text-on-surface-variant text-body-medium min-w-0 flex-1">
            {foldedIds.size === 1
              ? '1 calendar arrives on more than one account. It is listed once.'
              : `${String(foldedIds.size)} calendars arrive on more than one account. Each is listed once.`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            aria-expanded={expandCopies}
            onClick={() => {
              // Reversible in one click, and never a silent state: the sentence beside this button
              // states the collapse whether it is on or off.
              startViewTransition(() => {
                setExpandCopies((current) => !current);
              });
            }}
          >
            {expandCopies ? 'List once' : 'Show each copy'}
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
            <h3 className="text-on-surface-variant text-label-large truncate px-1.5 pt-1">
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
                redundancy={expandCopies ? undefined : redundancy.get(layer.id)}
                layerIds={
                  expandCopies ? [layer.id] : [layer.id, ...(foldedByKeptId.get(layer.id) ?? [])]
                }
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
