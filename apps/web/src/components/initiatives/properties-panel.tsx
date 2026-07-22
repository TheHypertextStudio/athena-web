'use client';

/** Initiative property controls rendered as an inline chip row in the entity masthead. */
import type {
  Health,
  InitiativePriority,
  InitiativeStatus,
  InitiativeUpdateCadence,
  LabelOut,
} from '@docket/types';
import {
  ActorPicker,
  DatePicker,
  EnumPicker,
  LabelsPicker,
  type PickerOption,
} from '@docket/ui/components';
import { type JSX, useMemo } from 'react';

import { RolledUpHealthPill } from '@/components/initiatives/health-pill';
import { enumOptions, HEALTH_OPTIONS, labelOptions } from '@/components/pickers/options';
import { ENTITY_METADATA_CHIP_CLASS } from '@/components/views/entity-detail-layout';
import { formatCalendarDate } from '@/lib/format-date';

/** Human labels for each Initiative lifecycle status (shared with the page's print + child rows). */
export const INITIATIVE_STATUS_LABEL: Record<InitiativeStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};
/** Human labels for each Initiative priority (shared with the page's print block). */
export const INITIATIVE_PRIORITY_LABEL: Record<InitiativePriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
/** Human labels for each Initiative update cadence (shared with the page's print block). */
export const INITIATIVE_CADENCE_LABEL: Record<InitiativeUpdateCadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  none: 'None',
};
const STATUS_ORDER: readonly InitiativeStatus[] = ['proposed', 'active', 'completed', 'canceled'];
const PRIORITY_ORDER: readonly InitiativePriority[] = ['none', 'low', 'medium', 'high'];
const CADENCE_ORDER: readonly InitiativeUpdateCadence[] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'none',
];

/** Props for {@link InitiativePropertiesPanel}. */
export interface InitiativePropertiesPanelProps {
  status: InitiativeStatus;
  health: Health | null;
  rolledUpHealth: Health | null;
  targetDate: string | null;
  ownerId: string | null;
  priority: InitiativePriority;
  updateCadence: InitiativeUpdateCadence;
  memberOptions: readonly PickerOption[];
  labels: readonly LabelOut[];
  availableLabels: readonly LabelOut[];
  canEdit: boolean;
  onStatusChange: (status: InitiativeStatus) => void;
  onHealthChange: (health: Health | null) => void;
  onTargetChange: (targetDate: string | null) => void;
  onOwnerChange: (ownerId: string | null) => void;
  onPriorityChange: (priority: InitiativePriority) => void;
  onCadenceChange: (updateCadence: InitiativeUpdateCadence) => void;
  onLabelsChange: (labelIds: readonly string[]) => void;
}

/** Shared chip trigger wiring so every property in the metadata row reads as the same pill. */
const CHIP = { triggerVariant: 'ghost', triggerClassName: ENTITY_METADATA_CHIP_CLASS } as const;

/**
 * Render the full Initiative property set as inline chip pickers.
 *
 * @remarks
 * Returns the property chips directly (no wrapper) so the caller can drop them into an
 * {@link EntityMetadataRow}. Order follows the canonical matrix: Status → Health →
 * Connected-work health (read-only roll-up) → Target → Owner → Priority → Cadence → Labels. The
 * rolled-up health is a non-interactive {@link RolledUpHealthPill} because it is auto-derived from
 * the associated children. Label editing runs through {@link LabelsPicker}.
 *
 * @param props - The {@link InitiativePropertiesPanelProps}.
 * @returns the inline property chips.
 */
export function InitiativePropertiesPanel({
  status,
  health,
  rolledUpHealth,
  targetDate,
  ownerId,
  priority,
  updateCadence,
  memberOptions,
  labels,
  availableLabels,
  canEdit,
  onStatusChange,
  onHealthChange,
  onTargetChange,
  onOwnerChange,
  onPriorityChange,
  onCadenceChange,
  onLabelsChange,
}: InitiativePropertiesPanelProps): JSX.Element {
  const readOnly = !canEdit;
  const labelIds = useMemo<readonly string[]>(() => labels.map((label) => label.id), [labels]);
  const labelPickerOptions = useMemo(() => labelOptions(availableLabels), [availableLabels]);

  return (
    <>
      <EnumPicker<InitiativeStatus>
        options={enumOptions(STATUS_ORDER, INITIATIVE_STATUS_LABEL)}
        value={status}
        onChange={(next) => {
          if (next) onStatusChange(next);
        }}
        placeholder="Choose status"
        ariaLabel="Status"
        readOnly={readOnly}
        {...CHIP}
      />
      <EnumPicker<Health>
        options={HEALTH_OPTIONS}
        value={health}
        onChange={onHealthChange}
        placeholder="No health"
        clearLabel="No health"
        ariaLabel="Initiative health"
        readOnly={readOnly}
        {...CHIP}
      />
      <RolledUpHealthPill health={rolledUpHealth} className="min-h-10 px-3" />
      <DatePicker
        value={targetDate ? targetDate.slice(0, 10) : null}
        onChange={onTargetChange}
        placeholder="Set target date"
        formatLabel={(value) => formatCalendarDate(value) ?? undefined}
        ariaLabel="Target date"
        readOnly={readOnly}
        {...CHIP}
      />
      <ActorPicker
        options={memberOptions}
        value={ownerId}
        onChange={onOwnerChange}
        placeholder="Set owner"
        clearLabel="No owner"
        ariaLabel="Owner"
        readOnly={readOnly}
        {...CHIP}
      />
      <EnumPicker<InitiativePriority>
        options={enumOptions(PRIORITY_ORDER, INITIATIVE_PRIORITY_LABEL)}
        value={priority}
        onChange={(next) => {
          if (next) onPriorityChange(next);
        }}
        placeholder="Choose priority"
        ariaLabel="Priority"
        readOnly={readOnly}
        {...CHIP}
      />
      <EnumPicker<InitiativeUpdateCadence>
        options={enumOptions(CADENCE_ORDER, INITIATIVE_CADENCE_LABEL)}
        value={updateCadence}
        onChange={(next) => {
          if (next) onCadenceChange(next);
        }}
        placeholder="Choose cadence"
        ariaLabel="Update cadence"
        readOnly={readOnly}
        {...CHIP}
      />
      <LabelsPicker
        options={labelPickerOptions}
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
        {...CHIP}
      />
    </>
  );
}
