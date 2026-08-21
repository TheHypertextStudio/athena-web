'use client';

/**
 * The initiative composer's property row, split out so the template editor renders the same
 * controls the create dialog does.
 *
 * @remarks
 * Mirrors `components/tasks/task-form-pickers.tsx`. Authoring a template has to look like creating
 * the thing the template makes, and the only way to guarantee that without drift is to render one
 * component in both places.
 */
import type {
  Health,
  InitiativePriority,
  InitiativeStatus,
  InitiativeUpdateCadence,
} from '@docket/types';
import type { PlanningTimeframe } from '@docket/work/planning-timeframe';
import { ActorPicker, EnumPicker, type PickerOption, TimeframePicker } from '@docket/ui/components';
import { Activity } from '@docket/ui/icons';
import { type JSX, useMemo } from 'react';

import { enumOptions, HEALTH_OPTIONS, statusOptions } from '@/components/pickers/options';
import { useStatusRegistry } from '@/components/statuses/status-registry';

const PRIORITY_ORDER: readonly InitiativePriority[] = ['none', 'low', 'medium', 'high'];
const PRIORITY_LABEL: Record<InitiativePriority, string> = {
  none: 'No priority',
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
};
const CADENCE_ORDER: readonly InitiativeUpdateCadence[] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'none',
];
const CADENCE_LABEL: Record<InitiativeUpdateCadence, string> = {
  weekly: 'Weekly updates',
  biweekly: 'Biweekly updates',
  monthly: 'Monthly updates',
  quarterly: 'Quarterly updates',
  none: 'No update cadence',
};

/** Props for {@link InitiativeComposerPickers}. */
export interface InitiativeComposerPickersProps {
  /** The owner options, from `useComposerOptions`. */
  actorOptions: readonly PickerOption[];
  /** The chosen owner, or null. Omitted entirely when the composer has no owner axis. */
  ownerId?: string | null;
  /** Report a changed owner. Omit alongside `ownerId` to hide the picker. */
  onOwnerChange?: (id: string | null) => void;
  /** The chosen lifecycle status. */
  status: InitiativeStatus;
  /** Report a changed status. */
  onStatusChange: (status: InitiativeStatus) => void;
  /** The chosen semantic target, or null. Omitted when the composer has no date axis. */
  targetTimeframe?: PlanningTimeframe | null;
  /** Current zero-based fiscal month used for new broad choices. */
  fiscalYearStartMonth?: number;
  /** Whether the workspace planning calendar is still loading. */
  planningCalendarLoading?: boolean;
  /** Report a changed target. Omit alongside `targetTimeframe` to hide the picker. */
  onTargetTimeframeChange?: (timeframe: PlanningTimeframe | null) => void;
  /** The chosen health verdict, or null. */
  health: Health | null;
  /** Report a changed health verdict. */
  onHealthChange: (health: Health | null) => void;
  /** The chosen priority. */
  priority: InitiativePriority;
  /** Report a changed priority. */
  onPriorityChange: (priority: InitiativePriority) => void;
  /** The chosen update cadence. */
  updateCadence: InitiativeUpdateCadence;
  /** Report a changed update cadence. */
  onUpdateCadenceChange: (cadence: InitiativeUpdateCadence) => void;
  /** Whether a submit is in flight, which disables every control. */
  disabled: boolean;
}

/**
 * The initiative composer's inline property pickers.
 *
 * @remarks
 * Owner and target date are optional axes. A template cannot store either — an owner who leaves
 * and a date that passes both turn a reusable template into a broken one — so the template editor
 * renders this component without them rather than showing controls whose values are silently
 * dropped on save.
 *
 * @param props - The {@link InitiativeComposerPickersProps}.
 * @returns the rendered pickers.
 */
export function InitiativeComposerPickers({
  actorOptions,
  ownerId,
  onOwnerChange,
  status,
  onStatusChange,
  targetTimeframe,
  fiscalYearStartMonth = 0,
  planningCalendarLoading = false,
  onTargetTimeframeChange,
  health,
  onHealthChange,
  priority,
  onPriorityChange,
  updateCadence,
  onUpdateCadenceChange,
  disabled,
}: InitiativeComposerPickersProps): JSX.Element {
  const statuses = useStatusRegistry();
  const initiativeStatusOptions = useMemo(
    () => statusOptions(statuses.statusesFor('initiative')),
    [statuses],
  );

  return (
    <>
      {onOwnerChange ? (
        <ActorPicker
          options={actorOptions}
          value={ownerId ?? null}
          onChange={onOwnerChange}
          placeholder="Set owner"
          clearLabel="No owner"
          ariaLabel="Owner"
          disabled={disabled}
        />
      ) : null}
      <EnumPicker
        options={initiativeStatusOptions}
        value={status}
        onChange={(next) => {
          if (next) onStatusChange(next);
        }}
        placeholder="Status"
        ariaLabel="Status"
        disabled={disabled}
      />
      {onTargetTimeframeChange ? (
        <TimeframePicker
          label="Initiative target"
          value={targetTimeframe ?? null}
          fiscalYearStartMonth={fiscalYearStartMonth}
          edge="target"
          onChange={onTargetTimeframeChange}
          disabled={disabled || planningCalendarLoading}
        />
      ) : null}
      <EnumPicker
        options={HEALTH_OPTIONS}
        value={health}
        onChange={onHealthChange}
        placeholder="Set health"
        triggerIcon={<Activity className="text-on-surface-variant size-4" />}
        clearLabel="No health"
        ariaLabel="Health"
        disabled={disabled}
      />
      <EnumPicker
        options={enumOptions(PRIORITY_ORDER, PRIORITY_LABEL)}
        value={priority}
        onChange={(next) => {
          if (next) onPriorityChange(next);
        }}
        placeholder="Priority"
        ariaLabel="Priority"
        disabled={disabled}
      />
      <EnumPicker
        options={enumOptions(CADENCE_ORDER, CADENCE_LABEL)}
        value={updateCadence}
        onChange={(next) => {
          if (next) onUpdateCadenceChange(next);
        }}
        placeholder="Update cadence"
        ariaLabel="Update cadence"
        disabled={disabled}
      />
    </>
  );
}
