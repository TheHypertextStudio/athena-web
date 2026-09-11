'use client';

/**
 * Milestone property controls, as an inline chip row in the entity masthead.
 *
 * @remarks
 * The same contract as the Project, Initiative and Program panels: a bare fragment of
 * {@link EntityMetadataItem}-wrapped controls, so the host drops it into an `EntityMetadataRow` and
 * owns the PATCH. Canonical order is Target date → progress.
 *
 * The progress count is not a picker. A milestone has no status of its own — completion is derived
 * from the tasks pointing at it — so this reads as a fact rather than a control, and says so by not
 * offering an affordance.
 */
import { DatePicker } from '@docket/ui/components';
import { Flag } from '@docket/ui/icons';
import { type JSX } from 'react';

import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
} from '@/components/views/entity-detail-layout';
import { formatCalendarDate } from '@/lib/format-date';

/** The shared chip configuration, matching every other detail masthead's property row. */
const CHIP = { triggerVariant: 'ghost', triggerClassName: ENTITY_METADATA_CHIP_CLASS } as const;

/** Props for {@link MilestonePropertiesPanel}. */
export interface MilestonePropertiesPanelProps {
  /** The target day (`YYYY-MM-DD`), or `null` when undated. */
  targetDate: string | null;
  /** Persist a new target day, or `null` to clear it. */
  onTargetDateChange: (next: string | null) => void;
  /** Completed tasks pointing at this milestone. */
  done: number;
  /** Total tasks pointing at this milestone. */
  total: number;
  /** The vocabulary-skinned lowercase task noun. */
  taskNoun: string;
  /** Whether the viewer may edit. */
  canEdit: boolean;
}

/** The milestone masthead's property chips. */
export function MilestonePropertiesPanel({
  targetDate,
  onTargetDateChange,
  done,
  total,
  taskNoun,
  canEdit,
}: MilestonePropertiesPanelProps): JSX.Element {
  return (
    <>
      <EntityMetadataItem priority={0}>
        <DatePicker
          {...CHIP}
          value={targetDate}
          onChange={onTargetDateChange}
          placeholder="Set target date"
          formatLabel={(value) => formatCalendarDate(value) ?? undefined}
          ariaLabel="Milestone target date"
          readOnly={!canEdit}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={1}>
        <span className="text-on-surface-variant text-label-large flex items-center gap-1.5 tabular-nums">
          <Flag aria-hidden className="size-4 shrink-0" />
          {done}/{total} {taskNoun}
          {total === 1 ? '' : 's'} done
        </span>
      </EntityMetadataItem>
    </>
  );
}
