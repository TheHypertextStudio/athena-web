'use client';

/**
 * The program properties panel — owner, status, health, and visibility.
 *
 * @remarks
 * A Program is an *ongoing* line of work, so its editable metadata is operational rather than
 * scheduled: who owns it, its lifecycle status (`active`/`paused`/`archived`), its current
 * health verdict, and its visibility. Per directive A each row is an interactive picker that
 * assigns the property through the program PATCH RPC (the host page owns the optimistic mutation
 * + rollback); an unset owner/health reads as a calm "Set <field>" affordance rather than a dead
 * row. A Program PATCH requires `manage`, so the host gates `canEdit` on that capability and the
 * rows render read-only otherwise.
 *
 * Presentational + controlled: it takes pre-resolved {@link PickerOption}s and current values,
 * and reports each change through a typed `onChange`. The host resolves members into options and
 * owns the PATCH.
 */
import { type Health, type ProgramStatus, type Visibility } from '@docket/types';
import { ActorPicker, EnumPicker, type PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Activity, Globe, Heart, User } from '@docket/ui/icons';
import type { JSX } from 'react';

import { PropertyPanel, PropertyPanelRow } from '@/components/property-pickers/property-panel';
import {
  healthOptions,
  programStatusOptions,
  visibilityOptions,
} from '@/components/property-pickers/options';

/** Props for {@link ProgramPropertiesPanel}. */
export interface ProgramPropertiesPanelProps {
  /** The current owner actor id, or `null` when unassigned. */
  ownerId: string | null;
  /** Member options for the owner picker (each carrying an `ActorAvatar`). */
  memberOptions: readonly PickerOption[];
  /** The current program status. */
  status: ProgramStatus;
  /** The current health verdict, or `null` when unset. */
  health: Health | null;
  /** The current visibility. */
  visibility: Visibility;
  /** Whether the actor may edit (holds `manage`); rows are read-only when false. */
  canEdit: boolean;
  /** Whether a mutation is in flight (disables every picker). */
  pending: boolean;
  /** Assign the owner (or `null` to clear). */
  onOwnerChange: (ownerId: string | null) => void;
  /** Set the program status. */
  onStatusChange: (status: ProgramStatus) => void;
  /** Set the health verdict (or `null` to clear). */
  onHealthChange: (health: Health | null) => void;
  /** Set the visibility. */
  onVisibilityChange: (visibility: Visibility) => void;
}

/**
 * The interactive program properties panel.
 *
 * @param props - The {@link ProgramPropertiesPanelProps}.
 * @returns the rendered panel.
 */
export function ProgramPropertiesPanel({
  ownerId,
  memberOptions,
  status,
  health,
  visibility,
  canEdit,
  pending,
  onOwnerChange,
  onStatusChange,
  onHealthChange,
  onVisibilityChange,
}: ProgramPropertiesPanelProps): JSX.Element {
  const programLabel = useVocabulary('program');
  const readOnly = !canEdit;

  return (
    <PropertyPanel>
      <h3 className="text-on-surface-variant px-1 pt-1 text-xs font-medium">
        {programLabel} properties
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

      <PropertyPanelRow divided icon={<Activity className="size-4" />} label="Status">
        <EnumPicker<ProgramStatus>
          options={programStatusOptions()}
          value={status}
          onChange={(next) => {
            if (next) onStatusChange(next);
          }}
          placeholder="Set status"
          ariaLabel="Status"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>

      <PropertyPanelRow divided icon={<Heart className="size-4" />} label="Health">
        <EnumPicker<Health>
          options={healthOptions()}
          value={health}
          onChange={onHealthChange}
          placeholder="Set health"
          clearLabel="No health"
          ariaLabel="Health"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>

      <PropertyPanelRow divided icon={<Globe className="size-4" />} label="Visibility">
        <EnumPicker<Visibility>
          options={visibilityOptions()}
          value={visibility}
          onChange={(next) => {
            if (next) onVisibilityChange(next);
          }}
          placeholder="Set visibility"
          ariaLabel="Visibility"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>
    </PropertyPanel>
  );
}
