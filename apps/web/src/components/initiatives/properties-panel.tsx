'use client';

/** Initiative property controls rendered as an inline chip row in the entity masthead. */
import type { Health } from '@docket/work/capability-contract';
import type {
  InitiativePriority,
  InitiativeStatus,
  InitiativeUpdateCadence,
} from '@docket/work/initiative-contract';
import type { LabelOut } from '@docket/work/label-contract';
import type { DateResolution, PlanningTimeframe } from '@docket/work/planning-timeframe';
import {
  ActorPicker,
  EnumPicker,
  LabelsPicker,
  TimeframePicker,
  type PickerOption,
} from '@docket/ui/components';
import { type JSX, useMemo } from 'react';

import {
  enumOptions,
  HEALTH_OPTIONS,
  labelOptions,
  statusOptions,
} from '@/components/pickers/options';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
} from '@/components/views/entity-detail-layout';
import { toPlanningTimeframe } from '@/lib/planning-timeframe';

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
  targetDate: string | null;
  targetDateResolution: DateResolution | null;
  targetDateFiscalYearStartMonth: number | null;
  fiscalYearStartMonth: number;
  planningCalendarLoading: boolean;
  ownerId: string | null;
  priority: InitiativePriority;
  updateCadence: InitiativeUpdateCadence;
  memberOptions: readonly PickerOption[];
  /** Whether the owner roster is loading after its picker opened. */
  ownerLoading?: boolean;
  /** Observe owner-picker visibility so the host can load its roster on demand. */
  onOwnerPickerOpenChange?: (open: boolean) => void;
  labels: readonly LabelOut[];
  availableLabels: readonly LabelOut[];
  /** Whether label assignments and options are loading after the picker opened. */
  labelsLoading?: boolean;
  /** Observe label-picker visibility so the host can load labels on demand. */
  onLabelsPickerOpenChange?: (open: boolean) => void;
  /** Observe target-picker visibility so the host can load fiscal settings on demand. */
  onTargetPickerOpenChange?: (open: boolean) => void;
  canEdit: boolean;
  onStatusChange: (status: InitiativeStatus) => void;
  onHealthChange: (health: Health | null) => void;
  onTargetChange: (target: PlanningTimeframe | null) => void;
  onOwnerChange: (ownerId: string | null) => void;
  onPriorityChange: (priority: InitiativePriority) => void;
  onCadenceChange: (updateCadence: InitiativeUpdateCadence) => void;
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
 * Render the full Initiative property set as inline chip pickers.
 *
 * @remarks
 * Returns the property chips directly (no wrapper) so the caller can drop them into an
 * {@link EntityMetadataRow}. Order follows the canonical matrix: Status → Health → Target → Owner
 * → Priority → Cadence → Labels. Connected-work rollups belong in analysis rather than beside the
 * editable Initiative health property. Label editing runs through {@link LabelsPicker}.
 *
 * @param props - The {@link InitiativePropertiesPanelProps}.
 * @returns the inline property chips.
 */
export function InitiativePropertiesPanel({
  status,
  health,
  targetDate,
  targetDateResolution,
  targetDateFiscalYearStartMonth,
  fiscalYearStartMonth,
  planningCalendarLoading,
  ownerId,
  priority,
  updateCadence,
  memberOptions,
  ownerLoading,
  onOwnerPickerOpenChange,
  labels,
  availableLabels,
  labelsLoading,
  onLabelsPickerOpenChange,
  onTargetPickerOpenChange,
  canEdit,
  onStatusChange,
  onHealthChange,
  onTargetChange,
  onOwnerChange,
  onPriorityChange,
  onCadenceChange,
  onLabelsChange,
  onCreateLabel,
}: InitiativePropertiesPanelProps): JSX.Element {
  const readOnly = !canEdit;
  const statuses = useStatusRegistry();
  const initiativeStatusOptions = useMemo(
    () => statusOptions(statuses.statusesFor('initiative')),
    [statuses],
  );
  const labelIds = useMemo<readonly string[]>(() => labels.map((label) => label.id), [labels]);
  const labelPickerOptions = useMemo(() => labelOptions(availableLabels), [availableLabels]);
  const targetTimeframe = toPlanningTimeframe(
    targetDate,
    targetDateResolution,
    targetDateFiscalYearStartMonth,
  );

  return (
    <>
      <EntityMetadataItem priority={0}>
        <EnumPicker
          options={initiativeStatusOptions}
          value={status}
          onChange={(next) => {
            if (next) onStatusChange(next);
          }}
          placeholder="Choose status"
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
          placeholder="No health"
          clearLabel="No health"
          ariaLabel="Initiative health"
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={2}>
        <TimeframePicker
          label="Target date"
          value={targetTimeframe}
          fiscalYearStartMonth={fiscalYearStartMonth}
          edge="target"
          onChange={onTargetChange}
          onOpenChange={onTargetPickerOpenChange}
          readOnly={readOnly}
          disabled={planningCalendarLoading}
          {...CHIP}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={3}>
        <ActorPicker
          options={memberOptions}
          value={ownerId}
          onChange={onOwnerChange}
          placeholder="Set owner"
          clearLabel="No owner"
          ariaLabel="Owner"
          loading={ownerLoading ?? false}
          {...(onOwnerPickerOpenChange ? { onOpenChange: onOwnerPickerOpenChange } : {})}
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={4}>
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
      </EntityMetadataItem>
      <EntityMetadataItem priority={5}>
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
      </EntityMetadataItem>
      <EntityMetadataItem priority={6}>
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
          loading={labelsLoading ?? false}
          {...(onLabelsPickerOpenChange ? { onOpenChange: onLabelsPickerOpenChange } : {})}
          readOnly={readOnly}
          {...CHIP}
        />
      </EntityMetadataItem>
    </>
  );
}
