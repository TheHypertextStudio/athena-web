'use client';

/** Progressive Project property controls rendered as an inline chip row in the entity masthead. */
import type { Health, LabelOut, ProjectStatus } from '@docket/types';
import type { DateResolution } from '@docket/work/planning-timeframe';
import {
  EntityMultiPicker,
  EntityPicker,
  EnumPicker,
  LabelsPicker,
  type PickerOption,
  TimeframeRangePicker,
  type TimeframeRangeValue,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Activity, Layers, Target } from '@docket/ui/icons';
import { type JSX, useMemo } from 'react';

import { HEALTH_OPTIONS, labelOptions, statusOptions } from '@/components/pickers/options';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
} from '@/components/views/entity-detail-layout';
import { toPlanningTimeframe } from '@/lib/planning-timeframe';

/** Props for {@link PropertiesPanel}. */
export interface PropertiesPanelProps {
  health: Health | null;
  status: ProjectStatus;
  startDate: string | null;
  startDateResolution: DateResolution | null;
  startDateFiscalYearStartMonth: number | null;
  targetDate: string | null;
  targetDateResolution: DateResolution | null;
  targetDateFiscalYearStartMonth: number | null;
  fiscalYearStartMonth: number;
  planningCalendarLoading: boolean;
  programId: string | null;
  programOptions: readonly PickerOption[];
  initiativeIds: readonly string[];
  initiativeOptions: readonly PickerOption[];
  labels: readonly LabelOut[];
  availableLabels: readonly LabelOut[];
  canEdit: boolean;
  onHealthChange: (health: Health | null) => void;
  onStatusChange: (status: ProjectStatus) => void;
  onTimelineChange: (range: TimeframeRangeValue) => void;
  onProgramChange: (programId: string | null) => void;
  onInitiativesChange: (initiativeIds: readonly string[]) => void;
  onLabelsChange: (labelIds: readonly string[]) => void;
  /**
   * Create a label from a name typed into the picker, and attach it.
   *
   * @remarks
   * Optional: omitting it hides the inline `Create "…"` row, which is what a read-only or
   * capability-limited viewer should see.
   */
  onCreateLabel?: (name: string) => void;
}

/** Shared chip trigger wiring so every property in the metadata row reads as the same pill. */
const CHIP = { triggerVariant: 'ghost', triggerClassName: ENTITY_METADATA_CHIP_CLASS } as const;

/**
 * Render the full Project property set as inline chip pickers.
 *
 * @remarks
 * Returns the property chips directly (no wrapper) so the caller can drop them into an
 * {@link EntityMetadataRow}. Order follows the canonical matrix: Status → Health → Timeline →
 * Program → Initiatives → Labels. Label editing runs through {@link LabelsPicker} rather than a
 * hand-rolled toggle strip.
 *
 * @param props - The {@link PropertiesPanelProps}.
 * @returns the inline property chips.
 */
export function PropertiesPanel({
  health,
  status,
  startDate,
  startDateResolution,
  startDateFiscalYearStartMonth,
  targetDate,
  targetDateResolution,
  targetDateFiscalYearStartMonth,
  fiscalYearStartMonth,
  planningCalendarLoading,
  programId,
  programOptions,
  initiativeIds,
  initiativeOptions,
  labels,
  availableLabels,
  canEdit,
  onHealthChange,
  onStatusChange,
  onTimelineChange,
  onProgramChange,
  onInitiativesChange,
  onLabelsChange,
  onCreateLabel,
}: PropertiesPanelProps): JSX.Element {
  const programLabel = useVocabulary('program');
  const initiativeLabel = useVocabulary('initiative');
  const readOnly = !canEdit;

  const statuses = useStatusRegistry();
  const projectStatusOptions = useMemo(
    () => statusOptions(statuses.statusesFor('project')),
    [statuses],
  );
  const labelPickerOptions = useMemo(() => labelOptions(availableLabels), [availableLabels]);
  const labelIds = useMemo<readonly string[]>(() => labels.map((label) => label.id), [labels]);
  const startTimeframe = toPlanningTimeframe(
    startDate,
    startDateResolution,
    startDateFiscalYearStartMonth,
  );
  const targetTimeframe = toPlanningTimeframe(
    targetDate,
    targetDateResolution,
    targetDateFiscalYearStartMonth,
  );

  return (
    <>
      <EntityMetadataItem priority={0}>
        <EnumPicker
          options={projectStatusOptions}
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
      <EntityMetadataItem priority={1}>
        <EnumPicker<Health>
          options={HEALTH_OPTIONS}
          value={health}
          onChange={onHealthChange}
          placeholder="Set health"
          triggerIcon={<Activity className="text-on-surface-variant size-4" />}
          clearLabel="No health"
          ariaLabel="Health"
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={2} className="max-w-none">
        <TimeframeRangePicker
          value={{ start: startTimeframe, target: targetTimeframe }}
          fiscalYearStartMonth={fiscalYearStartMonth}
          onChange={onTimelineChange}
          ariaLabel="Timeline"
          startLabel="Start date"
          targetLabel="Target date"
          readOnly={readOnly}
          disabled={planningCalendarLoading}
          {...CHIP}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={3}>
        <EntityPicker
          options={programOptions}
          value={programId}
          onChange={onProgramChange}
          placeholder={`Set ${programLabel.toLowerCase()}`}
          triggerIcon={<Layers className="text-on-surface-variant size-4" />}
          clearLabel={`No ${programLabel.toLowerCase()}`}
          searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
          ariaLabel={programLabel}
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={4}>
        <EntityMultiPicker
          options={initiativeOptions}
          value={initiativeIds}
          onToggle={(initiativeId) => {
            const next = initiativeIds.includes(initiativeId)
              ? initiativeIds.filter((id) => id !== initiativeId)
              : [...initiativeIds, initiativeId];
            onInitiativesChange(next);
          }}
          placeholder={`Add ${initiativeLabel.toLowerCase()}s`}
          triggerIcon={<Target className="text-on-surface-variant size-4" />}
          singularLabel={initiativeLabel.toLowerCase()}
          pluralLabel={`${initiativeLabel.toLowerCase()}s`}
          searchPlaceholder={`Search ${initiativeLabel.toLowerCase()}s…`}
          emptyText={`No ${initiativeLabel.toLowerCase()}s`}
          ariaLabel={`${initiativeLabel}s`}
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={5}>
        <LabelsPicker
          options={labelPickerOptions}
          value={labelIds}
          onToggle={(labelId) => {
            const next = labelIds.includes(labelId)
              ? labelIds.filter((id) => id !== labelId)
              : [...labelIds, labelId];
            onLabelsChange(next);
          }}
          {...(onCreateLabel ? { onCreate: onCreateLabel } : {})}
          placeholder="Add labels"
          searchPlaceholder="Filter labels…"
          emptyText="No labels"
          ariaLabel="Labels"
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
    </>
  );
}
