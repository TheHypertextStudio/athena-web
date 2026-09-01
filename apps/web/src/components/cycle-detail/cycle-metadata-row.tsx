'use client';

/**
 * `cycle-detail` — the cycle's editable properties, rendered as inline chips in the entity masthead.
 *
 * @remarks
 * This replaces the half-width "Cycle properties" card the detail page used to float beside ~315px
 * of dead space. A cycle only has two editable properties — its lifecycle status and its window —
 * and two rows of label + value inside a bordered box is far more chrome than two values deserve.
 * Rendered as chips in the shared {@link EntityMetadataRow}, they sit on the same line as every
 * other entity's properties (Project, Initiative, Program), share the one
 * {@link ENTITY_METADATA_CHIP_CLASS} pill treatment, and inherit the masthead's rhythm instead of
 * declaring a width of their own. It also removes the `border-t` hairline the old
 * `PropertyPanelRow` drew between rows, which was the "rule separating nothing" visible on a phone.
 *
 * Presentational + controlled: it takes the current values and reports each change through a typed
 * `onChange`; the host page owns the PATCH (and its optimistic update + rollback). Editing a cycle
 * requires `contribute` server-side, so the host gates `canEdit` on that and the chips render as
 * calm read-only text otherwise (a completed cycle is likewise read-only — reopening is its own
 * flow).
 */
import { type CycleStatus } from '@docket/work/cycle-contract';
import { DateRangePicker, EnumPicker } from '@docket/ui/components';
import type { JSX } from 'react';

import { CYCLE_STATUS_OPTIONS } from '@/components/pickers/options';
import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
} from '@/components/views/entity-detail-layout';
import { formatCalendarDate } from '@/lib/format-date';

/** Props for {@link CycleMetadata}. */
export interface CycleMetadataProps {
  /** The current cycle status. */
  status: CycleStatus;
  /** The window start as a bare calendar date (`YYYY-MM-DD`), or `null` when unset. */
  startsAt: string | null;
  /** The window end as a bare calendar date (`YYYY-MM-DD`), or `null` when unset. */
  endsAt: string | null;
  /** Whether the actor may edit (holds `contribute`); chips are read-only when false. */
  canEdit: boolean;
  /** Set the cycle status. */
  onStatusChange: (status: CycleStatus) => void;
  /** Set the window (both bounds are required by the create DTO; the host enforces it). */
  onWindowChange: (window: { start: string | null; end: string | null }) => void;
}

/** Shared chip trigger wiring so every property in the metadata row reads as the same pill. */
const CHIP = { triggerVariant: 'ghost', triggerClassName: ENTITY_METADATA_CHIP_CLASS } as const;

/** Day format for a window whose ends share a calendar year (e.g. `Jul 27`). */
const SAME_YEAR_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

/** Day format for a window that straddles a year boundary (e.g. `Dec 28, 2026`). */
const CROSS_YEAR_DAY: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

/**
 * The cycle's status + window property chips.
 *
 * @remarks
 * Returns the chips directly (no wrapper) so the caller can drop them into an
 * {@link EntityMetadataRow}, exactly as the Project and Initiative property panels do.
 *
 * The window chip's day format deliberately mirrors the rule
 * {@link file://../cycles/format-window.ts | formatWindow} applies to the masthead subtitle: the
 * year is shown only when the two ends fall in different calendar years. The subtitle and this chip
 * are the only two places a cycle's window appears on the page, and the audited defect was that
 * they disagreed ("Jul 26 – Aug 2" above "Jul 27, 2026 → Aug 2, 2026"); matching the rule is what
 * keeps one record from reading as two different date ranges. Both bounds arrive as bare
 * `YYYY-MM-DD` calendar dates, which {@link formatCalendarDate} renders as the same calendar day in
 * every timezone.
 *
 * @param props - The {@link CycleMetadataProps}.
 * @returns the inline property chips.
 */
export function CycleMetadata({
  status,
  startsAt,
  endsAt,
  canEdit,
  onStatusChange,
  onWindowChange,
}: CycleMetadataProps): JSX.Element {
  const readOnly = !canEdit;
  const crossesYear =
    startsAt !== null && endsAt !== null && startsAt.slice(0, 4) !== endsAt.slice(0, 4);
  const dayOptions = crossesYear ? CROSS_YEAR_DAY : SAME_YEAR_DAY;

  return (
    <>
      <EntityMetadataItem priority={0}>
        <EnumPicker<CycleStatus>
          options={CYCLE_STATUS_OPTIONS}
          value={status}
          onChange={(next) => {
            if (next) onStatusChange(next);
          }}
          placeholder="Set status"
          ariaLabel="Status"
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={1} className="max-w-none">
        <DateRangePicker
          value={{ start: startsAt, end: endsAt }}
          onChange={onWindowChange}
          startPlaceholder="Set start date"
          endPlaceholder="Set end date"
          formatLabel={(value) => formatCalendarDate(value, dayOptions) ?? undefined}
          ariaLabel="Window"
          startLabel="Starts"
          endLabel="Ends"
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
    </>
  );
}
