'use client';

/**
 * `calendar/calendar-layer-panel` — the full calendar view's layer visibility toggle panel.
 *
 * @remarks
 * One row per {@link CalendarLayerOut}: a visibility checkbox, its color swatch, title,
 * provider/account context, an editability badge, and sync health (last sync time / error), per
 * `docs/engineering/specs/calendar-ui.md`'s Layer Controls section. A toggle is wrapped in
 * {@link startViewTransition} (per this app's no-hard-swap rule) so the timeline's item set
 * reshapes rather than jumping when a layer's items appear/disappear; {@link useUpdateLayerVisibility}
 * is already optimistic, so the toggle itself never waits on the network.
 */
import type { CalendarLayerOut } from '@docket/types';
import { Badge } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { relativeTime } from '@/components/settings/format-time';
import { startViewTransition } from '@/lib/view-transition';

import { useUpdateLayerVisibility } from './calendar-mutations';

/** Props for {@link LayerRow}. */
interface LayerRowProps {
  /** The layer this row toggles/describes. */
  layer: CalendarLayerOut;
}

/** One layer's visibility row. */
function LayerRow({ layer }: LayerRowProps): JSX.Element {
  const update = useUpdateLayerVisibility(layer.id);

  return (
    <li className="hover:bg-surface-container-high flex items-center gap-2 rounded-md px-1.5 py-1.5">
      <input
        type="checkbox"
        checked={layer.selected}
        disabled={update.isPending}
        onChange={() => {
          startViewTransition(() => {
            update.mutate({ selected: !layer.selected });
          });
        }}
        aria-label={`Toggle ${layer.title} visibility`}
        className="accent-primary size-4 shrink-0"
      />
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: layer.color ?? 'var(--color-outline-variant)' }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-on-surface truncate text-sm">{layer.title}</span>
        <span className="text-on-surface-variant truncate text-[11px]">
          {[
            layer.provider ?? 'Docket',
            layer.lastSyncedAt ? `synced ${relativeTime(layer.lastSyncedAt)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      {!layer.editableCore ? (
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          Read-only
        </Badge>
      ) : null}
      {layer.lastError ? (
        <span
          role="img"
          aria-label={`Sync error: ${layer.lastError}`}
          title={layer.lastError}
          className="text-destructive shrink-0 text-xs"
        >
          !
        </span>
      ) : null}
    </li>
  );
}

/** Props for {@link CalendarLayerPanel}. */
export interface CalendarLayerPanelProps {
  /** Every calendar layer for the signed-in user, selected or not. */
  layers: readonly CalendarLayerOut[];
}

/** The layer visibility toggle panel. Renders an empty-state note when there are no layers yet. */
export default function CalendarLayerPanel({ layers }: CalendarLayerPanelProps): JSX.Element {
  if (layers.length === 0) {
    return (
      <p className="text-on-surface-variant text-xs">
        No calendar layers yet. Link a Google account or create a native block to get one.
      </p>
    );
  }
  return (
    <ul aria-label="Calendar layers" className="flex flex-col gap-0.5">
      {layers.map((layer) => (
        <LayerRow key={layer.id} layer={layer} />
      ))}
    </ul>
  );
}
