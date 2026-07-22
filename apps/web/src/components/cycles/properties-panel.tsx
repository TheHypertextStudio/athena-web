'use client';

/**
 * The cycle properties panel — status and window.
 *
 * @remarks
 * A Cycle is a team cadence, so its editable metadata is its lifecycle status
 * (`upcoming`/`active`/`completed`) and its window (start → end). Per directive A each is an
 * interactive picker that assigns the property through the cycle PATCH RPC (the host page owns
 * the optimistic mutation + rollback); an unset window reads as a calm "Set window" affordance
 * rather than a dead row. Editing a Cycle requires `contribute`; the host gates `canEdit` on it
 * and the rows render read-only otherwise. (A completed cycle is also rendered read-only by the
 * host, since reopening is a separate flow.)
 *
 * Presentational + controlled: it takes the current values and reports each change through a
 * typed `onChange`; the host owns the PATCH.
 */
import { type CycleStatus } from '@docket/types';
import { DateRangePicker, EnumPicker } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Activity, RefreshCw } from '@docket/ui/icons';
import type { JSX } from 'react';

import { PropertyPanel, PropertyPanelRow } from '@/components/property-pickers/property-panel';
import { cycleStatusOptions } from '@/components/property-pickers/options';
import { formatCalendarDate } from '@/lib/format-date';

/** Props for {@link CyclePropertiesPanel}. */
export interface CyclePropertiesPanelProps {
  /** The current cycle status. */
  status: CycleStatus;
  /** The ISO window start (`startsAt`). */
  startsAt: string | null;
  /** The ISO window end (`endsAt`). */
  endsAt: string | null;
  /** Whether the actor may edit (holds `contribute`); rows are read-only when false. */
  canEdit: boolean;
  /** Whether a mutation is in flight (disables every picker). */
  /** Set the cycle status. */
  onStatusChange: (status: CycleStatus) => void;
  /** Set the window (both bounds are required by the create DTO; the host enforces it). */
  onWindowChange: (window: { start: string | null; end: string | null }) => void;
}

/**
 * The interactive cycle properties panel.
 *
 * @param props - The {@link CyclePropertiesPanelProps}.
 * @returns the rendered panel.
 */
export function CyclePropertiesPanel({
  status,
  startsAt,
  endsAt,
  canEdit,
  onStatusChange,
  onWindowChange,
}: CyclePropertiesPanelProps): JSX.Element {
  const cycleLabel = useVocabulary('cycle');
  const readOnly = !canEdit;

  return (
    <PropertyPanel>
      <h3 className="text-on-surface-variant px-1 pt-1 text-xs font-medium">
        {cycleLabel} properties
      </h3>

      <PropertyPanelRow icon={<Activity className="size-4" />} label="Status">
        <EnumPicker<CycleStatus>
          options={cycleStatusOptions()}
          value={status}
          onChange={(next) => {
            if (next) onStatusChange(next);
          }}
          placeholder="Set status"
          ariaLabel="Status"
          readOnly={readOnly}
        />
      </PropertyPanelRow>

      <PropertyPanelRow divided icon={<RefreshCw className="size-4" />} label="Window">
        <DateRangePicker
          value={{ start: startsAt, end: endsAt }}
          onChange={onWindowChange}
          placeholder="Set window"
          formatLabel={(value) => formatCalendarDate(value) ?? undefined}
          ariaLabel="Window"
          startLabel="Starts"
          endLabel="Ends"
          readOnly={readOnly}
        />
      </PropertyPanelRow>
    </PropertyPanel>
  );
}
