'use client';

/**
 * The program composer's property row, split out so the template editor renders the same controls
 * the create dialog does.
 *
 * @remarks
 * Owner is the one optional axis: a template cannot store one, because an owner who leaves the
 * workspace would turn every template naming them into a template that fails to apply.
 */
import type { Health, ProgramStatus, Visibility } from '@docket/types';
import { ActorPicker, EnumPicker, type PickerOption } from '@docket/ui/components';
import { Activity } from '@docket/ui/icons';
import type { JSX } from 'react';

import { enumOptions, HEALTH_OPTIONS, VISIBILITY_OPTIONS } from '@/components/pickers/options';
import { STATUS_LABEL } from '@/components/programs/program-status';

/** The Program lifecycle statuses, ordered live → quiet. */
const PROGRAM_STATUS_ORDER: readonly ProgramStatus[] = ['active', 'paused', 'archived'];

/** Props for {@link ProgramComposerPickers}. */
export interface ProgramComposerPickersProps {
  /** The owner options, from `useComposerOptions`. */
  actorOptions: readonly PickerOption[];
  /** The chosen owner, or null. Omitted entirely when the composer has no owner axis. */
  ownerId?: string | null;
  /** Report a changed owner. Omit alongside `ownerId` to hide the picker. */
  onOwnerChange?: (id: string | null) => void;
  /** The chosen lifecycle status. */
  status: ProgramStatus;
  /** Report a changed status. */
  onStatusChange: (status: ProgramStatus) => void;
  /** The chosen health verdict, or null. */
  health: Health | null;
  /** Report a changed health verdict. */
  onHealthChange: (health: Health | null) => void;
  /** The chosen access scope. */
  visibility: Visibility;
  /** Report a changed access scope. */
  onVisibilityChange: (visibility: Visibility) => void;
  /** Whether a submit is in flight, which disables every control. */
  disabled: boolean;
}

/**
 * The program composer's inline property pickers.
 *
 * @param props - The {@link ProgramComposerPickersProps}.
 * @returns the rendered pickers.
 */
export function ProgramComposerPickers({
  actorOptions,
  ownerId,
  onOwnerChange,
  status,
  onStatusChange,
  health,
  onHealthChange,
  visibility,
  onVisibilityChange,
  disabled,
}: ProgramComposerPickersProps): JSX.Element {
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
        options={enumOptions(PROGRAM_STATUS_ORDER, STATUS_LABEL)}
        value={status}
        onChange={(next) => {
          if (next) onStatusChange(next);
        }}
        placeholder="Status"
        ariaLabel="Status"
        disabled={disabled}
      />
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
        options={VISIBILITY_OPTIONS}
        value={visibility}
        onChange={(next) => {
          if (next) onVisibilityChange(next);
        }}
        placeholder="Visibility"
        ariaLabel="Visibility"
        disabled={disabled}
      />
    </>
  );
}
