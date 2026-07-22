'use client';

/** Progressive Project property controls rendered as an inline chip row in the entity masthead. */
import type { Health, LabelOut, ProjectStatus } from '@docket/types';
import {
  DateRangePicker,
  EntityMultiPicker,
  EntityPicker,
  EnumPicker,
  LabelsPicker,
  type PickerOption,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { type JSX, useMemo } from 'react';

import { HEALTH_OPTIONS } from '@/components/pickers/options';
import { projectStatusOptions } from '@/components/property-pickers/options';
import { ENTITY_METADATA_CHIP_CLASS } from '@/components/views/entity-detail-layout';
import { formatCalendarDate } from '@/lib/format-date';

/** Props for {@link PropertiesPanel}. */
export interface PropertiesPanelProps {
  health: Health | null;
  status: ProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  programId: string | null;
  programOptions: readonly PickerOption[];
  initiativeIds: readonly string[];
  initiativeOptions: readonly PickerOption[];
  labels: readonly LabelOut[];
  availableLabels: readonly LabelOut[];
  canEdit: boolean;
  pending: boolean;
  onHealthChange: (health: Health | null) => void;
  onStatusChange: (status: ProjectStatus) => void;
  onTimelineChange: (range: { start: string | null; end: string | null }) => void;
  onProgramChange: (programId: string | null) => void;
  onInitiativesChange: (initiativeIds: readonly string[]) => void;
  onLabelsChange: (labelIds: readonly string[]) => void;
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
  targetDate,
  programId,
  programOptions,
  initiativeIds,
  initiativeOptions,
  labels,
  availableLabels,
  canEdit,
  pending,
  onHealthChange,
  onStatusChange,
  onTimelineChange,
  onProgramChange,
  onInitiativesChange,
  onLabelsChange,
}: PropertiesPanelProps): JSX.Element {
  const programLabel = useVocabulary('program');
  const initiativeLabel = useVocabulary('initiative');
  const readOnly = !canEdit;

  const labelOptions = useMemo<readonly PickerOption[]>(
    () =>
      availableLabels.map((label) => ({
        value: label.id,
        label: label.name,
        icon: (
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: label.color }}
          />
        ),
      })),
    [availableLabels],
  );
  const labelIds = useMemo<readonly string[]>(() => labels.map((label) => label.id), [labels]);

  return (
    <>
      <EnumPicker<ProjectStatus>
        options={projectStatusOptions()}
        value={status}
        onChange={(next) => {
          if (next) onStatusChange(next);
        }}
        placeholder="Set status"
        ariaLabel="Status"
        readOnly={readOnly}
        disabled={pending}
        {...CHIP}
      />
      <EnumPicker<Health>
        options={HEALTH_OPTIONS}
        value={health}
        onChange={onHealthChange}
        placeholder="Set health"
        clearLabel="No health"
        ariaLabel="Health"
        readOnly={readOnly}
        disabled={pending}
        {...CHIP}
      />
      <DateRangePicker
        value={{ start: startDate, end: targetDate }}
        onChange={onTimelineChange}
        placeholder="Set timeline"
        formatLabel={(value) => formatCalendarDate(value) ?? undefined}
        ariaLabel="Timeline"
        startLabel="Start"
        endLabel="Target"
        readOnly={readOnly}
        disabled={pending}
        {...CHIP}
      />
      <EntityPicker
        options={programOptions}
        value={programId}
        onChange={onProgramChange}
        placeholder={`Set ${programLabel.toLowerCase()}`}
        clearLabel={`No ${programLabel.toLowerCase()}`}
        searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
        ariaLabel={programLabel}
        readOnly={readOnly}
        disabled={pending}
        {...CHIP}
      />
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
        singularLabel={initiativeLabel.toLowerCase()}
        pluralLabel={`${initiativeLabel.toLowerCase()}s`}
        searchPlaceholder={`Search ${initiativeLabel.toLowerCase()}s…`}
        emptyText={`No ${initiativeLabel.toLowerCase()}s`}
        ariaLabel={`${initiativeLabel}s`}
        readOnly={readOnly}
        disabled={pending}
        {...CHIP}
      />
      <LabelsPicker
        options={labelOptions}
        value={labelIds}
        onToggle={(labelId) => {
          const next = labelIds.includes(labelId)
            ? labelIds.filter((id) => id !== labelId)
            : [...labelIds, labelId];
          onLabelsChange(next);
        }}
        placeholder="Add labels"
        searchPlaceholder="Filter labels…"
        emptyText="No labels"
        ariaLabel="Labels"
        readOnly={readOnly}
        disabled={pending}
        {...CHIP}
      />
    </>
  );
}
