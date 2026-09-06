'use client';

/** The Calendar layer visibility panel backed by server-owned logical source groups. */
import type { CalendarLayerOut, CalendarSourceGroupOut } from '@docket/planning/calendar-contract';
import { Layers } from '@docket/ui/icons';
import { Badge, Checkbox } from '@docket/ui/primitives';
import { type JSX, useMemo } from 'react';

import { relativeTime } from '@/components/settings/format-time';
import { useApiQuery } from '@/lib/query';
import { startViewTransition } from '@/lib/view-transition';

import { calendarSettingsDef } from './calendar-data';
import {
  useUpdateCalendarSourceGroupVisibility,
  useUpdateLayerVisibility,
} from './calendar-mutations';

interface LayerRowViewProps {
  readonly layer: CalendarLayerOut;
  readonly selected: boolean;
  readonly sourceCount: number;
  readonly pending: boolean;
  readonly onToggle: () => void;
}

/** Render one canonical calendar row without exposing its redundant provider copies. */
function LayerRowView({
  layer,
  selected,
  sourceCount,
  pending,
  onToggle,
}: LayerRowViewProps): JSX.Element {
  const source = layer.provider === null ? 'Docket' : 'External calendar';
  const supporting = [
    source === layer.title.trim() ? null : source,
    layer.lastSyncedAt ? `synced ${relativeTime(layer.lastSyncedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="hover:bg-surface-container-high flex items-start gap-2 rounded-md px-1.5 py-1.5">
      <Checkbox
        checked={selected}
        disabled={pending}
        onChange={onToggle}
        aria-label={`Toggle ${layer.title} visibility`}
        className="mt-0.5"
      />
      <span
        aria-hidden="true"
        className="mt-[0.4375rem] size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: layer.color ?? 'var(--color-outline-variant)' }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-on-surface text-body-medium truncate">{layer.title}</span>
        {supporting ? (
          <span className="text-on-surface-variant text-body-medium truncate">{supporting}</span>
        ) : null}
      </div>
      {sourceCount > 1 ? (
        <span className="text-on-surface-variant text-body-small flex shrink-0 items-center gap-1 pt-0.5">
          <Layers aria-hidden="true" className="size-4" />
          {sourceCount} accounts
        </span>
      ) : null}
      {!layer.editableCore ? (
        <Badge variant="secondary" className="mt-0.5 shrink-0">
          Read-only
        </Badge>
      ) : null}
    </li>
  );
}

interface LogicalLayerRowProps {
  readonly group: CalendarSourceGroupOut;
  readonly layer: CalendarLayerOut;
}

/** One server-resolved logical calendar whose visibility changes in one transaction. */
function LogicalLayerRow({ group, layer }: LogicalLayerRowProps): JSX.Element {
  const update = useUpdateCalendarSourceGroupVisibility(
    group.id,
    group.sources.map((source) => source.layerId),
  );
  return (
    <LayerRowView
      layer={{ ...layer, title: group.title, color: group.color }}
      selected={group.selected}
      sourceCount={group.sources.length}
      pending={update.isPending}
      onToggle={() => {
        startViewTransition(() => {
          update.mutate({ selected: !group.selected, visibleByDefault: !group.selected });
        });
      }}
    />
  );
}

/** A safe fallback while logical settings are unavailable. */
function PhysicalLayerRow({ layer }: { readonly layer: CalendarLayerOut }): JSX.Element {
  const update = useUpdateLayerVisibility(layer.id);
  return (
    <LayerRowView
      layer={layer}
      selected={layer.selected}
      sourceCount={1}
      pending={update.isPending}
      onToggle={() => {
        startViewTransition(() => {
          update.mutate({ selected: !layer.selected });
        });
      }}
    />
  );
}

interface LogicalRowModel {
  readonly group: CalendarSourceGroupOut;
  readonly layer: CalendarLayerOut;
}

function resolveLogicalRows(
  layers: readonly CalendarLayerOut[],
  groups: readonly CalendarSourceGroupOut[],
): { logical: readonly LogicalRowModel[]; ungrouped: readonly CalendarLayerOut[] } {
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const represented = new Set<string>();
  const logical = groups.flatMap((group) => {
    for (const source of group.sources) represented.add(source.layerId);
    const preferred = layerById.get(group.preferredLayerId);
    const fallback = group.sources.flatMap((source) => {
      const layer = layerById.get(source.layerId);
      return layer ? [layer] : [];
    })[0];
    const layer = preferred ?? fallback;
    return layer ? [{ group, layer }] : [];
  });
  return { logical, ungrouped: layers.filter((layer) => !represented.has(layer.id)) };
}

/** Props for {@link CalendarLayerPanel}. */
export interface CalendarLayerPanelProps {
  readonly layers: readonly CalendarLayerOut[];
}

/** Render one row per logical calendar and retain raw layers only as an outage fallback. */
export default function CalendarLayerPanel({ layers }: CalendarLayerPanelProps): JSX.Element {
  const settings = useApiQuery(calendarSettingsDef());
  const resolved = useMemo(
    () => resolveLogicalRows(layers, settings.data?.sourceGroups ?? []),
    [layers, settings.data?.sourceGroups],
  );
  if (layers.length === 0) {
    return (
      <p className="text-on-surface-variant text-body-medium">
        No calendar layers yet. Link a Google account or create a native block to get one.
      </p>
    );
  }
  if (settings.isPending) {
    return (
      <p className="text-on-surface-variant text-body-medium" aria-live="polite">
        Loading calendar sources…
      </p>
    );
  }
  const hasLogicalSettings = settings.data !== undefined && !settings.isError;
  return (
    <ul aria-label="Calendar layers" className="flex flex-col gap-0.5">
      {hasLogicalSettings
        ? resolved.logical.map(({ group, layer }) => (
            <LogicalLayerRow key={group.id} group={group} layer={layer} />
          ))
        : layers.map((layer) => <PhysicalLayerRow key={layer.id} layer={layer} />)}
      {hasLogicalSettings
        ? resolved.ungrouped.map((layer) => <PhysicalLayerRow key={layer.id} layer={layer} />)
        : null}
    </ul>
  );
}
