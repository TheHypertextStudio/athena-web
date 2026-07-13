'use client';

/**
 * The project properties panel — lead, status, timeline, program, and initiative.
 *
 * @remarks
 * The right-rail summary of a project's structural metadata, mirroring Linear's project
 * properties. Per directive A every row is *interactive*: clicking a property opens a compact
 * picker that assigns it through the project PATCH RPC (the host page owns the optimistic
 * mutation + rollback), and an unset property reads as a calm "Set <field>" affordance rather
 * than a dead "Not set" row. The lead is an {@link ActorPicker} over the org's members; status
 * is an {@link EnumPicker}; the timeline is a {@link DateRangePicker} over
 * start/target; program and initiative are {@link EntityPicker}s whose nouns are
 * vocabulary-skinned by the host page. When the actor lacks `contribute` the rows render
 * read-only (plain value text / em-dash) so the panel still reads as complete.
 *
 * The panel is presentational + controlled: it takes pre-resolved {@link PickerOption}s and the
 * current values, and reports each change through a typed `onChange` callback. The host page
 * resolves members/programs/initiatives into options and owns the PATCH, exactly as the picker
 * family is designed to be used.
 */
import type { ProjectStatus } from '@docket/types';
import {
  ActorPicker,
  DateRangePicker,
  EntityPicker,
  EnumPicker,
  type PickerOption,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Activity, FolderKanban, LayoutGrid, RefreshCw, User } from '@docket/ui/icons';
import type { JSX } from 'react';

import { PropertyPanel, PropertyPanelRow } from '@/components/property-pickers/property-panel';
import { projectStatusOptions } from '@/components/property-pickers/options';
import { formatCalendarDate } from '@/lib/format-date';

/** Props for {@link PropertiesPanel}. */
export interface PropertiesPanelProps {
  /** The current lead actor id, or `null` when unassigned. */
  leadId: string | null;
  /** Member options for the lead picker (each carrying an `ActorAvatar`). */
  memberOptions: readonly PickerOption[];
  /** The current project status. */
  status: ProjectStatus;
  /** ISO start date, when scheduled. */
  startDate: string | null;
  /** ISO target date, when scheduled. */
  targetDate: string | null;
  /** The current parent program id, or `null` when none. */
  programId: string | null;
  /** Program options for the program picker. */
  programOptions: readonly PickerOption[];
  /** The current associated initiative id, or `null` when none. */
  initiativeId: string | null;
  /** Initiative options for the initiative picker. */
  initiativeOptions: readonly PickerOption[];
  /** Whether the actor may edit (holds `contribute`); rows are read-only when false. */
  canEdit: boolean;
  /** Whether a mutation is in flight (disables every picker). */
  pending: boolean;
  /** Assign the lead (or `null` to clear). */
  onLeadChange: (leadId: string | null) => void;
  /** Set the project status. */
  onStatusChange: (status: ProjectStatus) => void;
  /** Set the start/target timeline (either bound may be `null`). */
  onTimelineChange: (range: { start: string | null; end: string | null }) => void;
  /** Attach to a program (or `null` to detach). */
  onProgramChange: (programId: string | null) => void;
  /** Associate with an initiative (or `null` to disassociate). */
  onInitiativeChange: (initiativeId: string | null) => void;
}

/**
 * The interactive project properties panel.
 *
 * @param props - The {@link PropertiesPanelProps}.
 * @returns the rendered panel.
 */
export function PropertiesPanel({
  leadId,
  memberOptions,
  status,
  startDate,
  targetDate,
  programId,
  programOptions,
  initiativeId,
  initiativeOptions,
  canEdit,
  pending,
  onLeadChange,
  onStatusChange,
  onTimelineChange,
  onProgramChange,
  onInitiativeChange,
}: PropertiesPanelProps): JSX.Element {
  const programLabel = useVocabulary('program');
  const initiativeLabel = useVocabulary('initiative');
  const programLower = programLabel.toLowerCase();
  const initiativeLower = initiativeLabel.toLowerCase();
  const readOnly = !canEdit;

  return (
    <PropertyPanel>
      <PropertyPanelRow icon={<User className="size-4" />} label="Lead">
        <ActorPicker
          options={memberOptions}
          value={leadId}
          onChange={onLeadChange}
          placeholder="Set lead"
          clearLabel="No lead"
          ariaLabel="Lead"
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>

      <PropertyPanelRow divided icon={<Activity className="size-4" />} label="Status">
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
        />
      </PropertyPanelRow>

      <PropertyPanelRow divided icon={<RefreshCw className="size-4" />} label="Timeline">
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
        />
      </PropertyPanelRow>

      <PropertyPanelRow divided icon={<FolderKanban className="size-4" />} label={programLabel}>
        <EntityPicker
          options={programOptions}
          value={programId}
          onChange={onProgramChange}
          placeholder={`Set ${programLower}`}
          clearLabel={`No ${programLower}`}
          searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
          ariaLabel={programLabel}
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>

      <PropertyPanelRow divided icon={<LayoutGrid className="size-4" />} label={initiativeLabel}>
        <EntityPicker
          options={initiativeOptions}
          value={initiativeId}
          onChange={onInitiativeChange}
          placeholder={`Set ${initiativeLower}`}
          clearLabel={`No ${initiativeLower}`}
          searchPlaceholder={`Search ${initiativeLabel.toLowerCase()}s…`}
          ariaLabel={initiativeLabel}
          readOnly={readOnly}
          disabled={pending}
        />
      </PropertyPanelRow>
    </PropertyPanel>
  );
}
