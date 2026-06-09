'use client';

/**
 * The initiative properties panel — owner and target date.
 *
 * @remarks
 * An Initiative is a cross-cutting *theme* whose status and rolled-up health are auto-derived
 * from its associated children, so those are intentionally NOT editable here — the panel exposes
 * the two properties an Initiative genuinely owns: its accountable owner and its target date. Per
 * directive A each is an interactive picker that assigns the property through the initiative
 * PATCH RPC (the host page owns the optimistic mutation + rollback), and an unset value reads as
 * a calm "Set <field>" affordance rather than a dead row. Editing an Initiative requires
 * `contribute`; the host gates `canEdit` on it and the rows render read-only otherwise.
 *
 * Presentational + controlled: it takes pre-resolved {@link PickerOption}s and the current
 * values, and reports each change through a typed `onChange`. The host resolves members into
 * options and owns the PATCH.
 */
import { ActorPicker, DatePicker, type PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Calendar, User } from '@docket/ui/icons';
import type { JSX } from 'react';

import { PropertyPanel, PropertyPanelRow } from '@/components/property-pickers/property-panel';
import { formatCalendarDate } from '@/lib/format-date';

/** Props for {@link InitiativePropertiesPanel}. */
export interface InitiativePropertiesPanelProps {
  /** The current owner actor id, or `null` when unassigned. */
  ownerId: string | null;
  /** Member options for the owner picker (each carrying an `ActorAvatar`). */
  memberOptions: readonly PickerOption[];
  /** The current ISO target date, or `null` when unscheduled. */
  targetDate: string | null;
  /** Whether the actor may edit (holds `contribute`); rows are read-only when false. */
  canEdit: boolean;
  /** Whether a mutation is in flight (disables every picker). */
  pending: boolean;
  /** Assign the owner (or `null` to clear). */
  onOwnerChange: (ownerId: string | null) => void;
  /** Set the target date (or `null` to clear). */
  onTargetDateChange: (targetDate: string | null) => void;
}

/**
 * The interactive initiative properties panel.
 *
 * @param props - The {@link InitiativePropertiesPanelProps}.
 * @returns the rendered panel.
 */
export function InitiativePropertiesPanel({
  ownerId,
  memberOptions,
  targetDate,
  canEdit,
  pending,
  onOwnerChange,
  onTargetDateChange,
}: InitiativePropertiesPanelProps): JSX.Element {
  const initiativeLabel = useVocabulary('initiative');
  const readOnly = !canEdit;

  return (
    <PropertyPanel>
      <h3 className="text-on-surface-variant px-1 pt-1 text-xs font-medium">
        {initiativeLabel} properties
      </h3>

      <PropertyPanelRow icon={<User className="size-4" />} label="Owner">
        <ActorPicker
          options={memberOptions}
          value={ownerId}
          onChange={onOwnerChange}
          placeholder="Set owner"
          clearLabel="No owner"
          ariaLabel="Owner"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>

      <PropertyPanelRow divided icon={<Calendar className="size-4" />} label="Target date">
        <DatePicker
          value={targetDate}
          onChange={onTargetDateChange}
          placeholder="Set target date"
          formatLabel={(value) => formatCalendarDate(value) ?? undefined}
          ariaLabel="Target date"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>
    </PropertyPanel>
  );
}
