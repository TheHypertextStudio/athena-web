'use client';

/**
 * The project composer's property row, split out so the template editor renders the same controls
 * the create dialog does.
 *
 * @remarks
 * Status and health are always shown. The reference axes — team, lead, program, timeline, linked
 * initiatives — are optional, because a template stores none of them: each names a row that can be
 * archived or a date that can pass, and a template that fails to apply is worse than a template
 * that asks for one more click. The editor mounts this without them rather than showing controls
 * whose values would be dropped on save.
 */
import type { Health, ProjectStatus } from '@docket/types';
import {
  ActorPicker,
  DateRangePicker,
  EntityPicker,
  EnumPicker,
  LabelsPicker,
  type PickerOption,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Activity, Layers, Target } from '@docket/ui/icons';
import type { TeamOut } from '@docket/types';
import type { JSX } from 'react';

import { HEALTH_OPTIONS, PROJECT_STATUS_OPTIONS } from '@/components/pickers/options';
import { TeamPicker } from '@/components/teams/team-picker';
import { formatCalendarDate } from '@/lib/format-date';

/** Format an ISO date for a picker trigger, narrowing the app helper's `null` to `undefined`. */
function triggerDate(value: string | null): string | undefined {
  return formatCalendarDate(value, { month: 'short', day: 'numeric' }) ?? undefined;
}

/** The optional reference axes, supplied together or not at all. */
export interface ProjectComposerReferenceAxes {
  /** The teams a project may belong to. */
  teams: readonly TeamOut[];
  /** The chosen team, or null. */
  teamId: string | null;
  /** Report a changed team. */
  onTeamChange: (id: string | null) => void;
  /** The lead options. */
  actorOptions: readonly PickerOption[];
  /** The chosen lead, or null. */
  leadId: string | null;
  /** Report a changed lead. */
  onLeadChange: (id: string | null) => void;
  /** The program options. */
  programOptions: readonly PickerOption[];
  /** The chosen program, or null. */
  programId: string | null;
  /** Report a changed program. */
  onProgramChange: (id: string | null) => void;
  /** Whether Program remains in the lower strip instead of being promoted into global context. */
  showProgram?: boolean;
  /** The planned start date, or null. */
  startDate: string | null;
  /** The planned target date, or null. */
  targetDate: string | null;
  /** Report a changed timeline. */
  onTimelineChange: (range: { start: string | null; end: string | null }) => void;
  /** The initiative options. */
  initiativeOptions: readonly PickerOption[];
  /** The linked initiative ids. */
  initiativeIds: readonly string[];
  /** Toggle one initiative link. */
  onInitiativeToggle: (id: string) => void;
}

/** Props for {@link ProjectComposerPickers}. */
export interface ProjectComposerPickersProps {
  /** The chosen lifecycle status. */
  status: ProjectStatus;
  /** Report a changed status. */
  onStatusChange: (status: ProjectStatus) => void;
  /** The chosen health verdict, or null. */
  health: Health | null;
  /** Report a changed health verdict. */
  onHealthChange: (health: Health | null) => void;
  /** The reference axes, omitted entirely by the template editor. */
  references?: ProjectComposerReferenceAxes;
  /** Whether a submit is in flight, which disables every control. */
  disabled: boolean;
}

/**
 * The project composer's inline property pickers.
 *
 * @param props - The {@link ProjectComposerPickersProps}.
 * @returns the rendered pickers.
 */
export function ProjectComposerPickers({
  status,
  onStatusChange,
  health,
  onHealthChange,
  references,
  disabled,
}: ProjectComposerPickersProps): JSX.Element {
  const initiativeNoun = useVocabulary('initiative');
  const programLabel = useVocabulary('program');

  return (
    <>
      <EnumPicker
        options={PROJECT_STATUS_OPTIONS}
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
      {references ? (
        <>
          <TeamPicker
            teams={references.teams}
            value={references.teamId}
            onChange={references.onTeamChange}
            disabled={disabled}
          />
          <ActorPicker
            options={references.actorOptions}
            value={references.leadId}
            onChange={references.onLeadChange}
            placeholder="Set lead"
            clearLabel="No lead"
            ariaLabel="Lead"
            disabled={disabled}
          />
          {references.showProgram !== false ? (
            <EntityPicker
              options={references.programOptions}
              value={references.programId}
              onChange={references.onProgramChange}
              placeholder={`Set ${programLabel.toLowerCase()}`}
              triggerIcon={<Layers className="text-on-surface-variant size-4" />}
              clearLabel={`No ${programLabel.toLowerCase()}`}
              searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
              ariaLabel={programLabel}
              disabled={disabled}
            />
          ) : null}
          <DateRangePicker
            value={{ start: references.startDate, end: references.targetDate }}
            onChange={references.onTimelineChange}
            placeholder="Set timeline"
            formatLabel={triggerDate}
            ariaLabel="Timeline"
            startLabel="Start"
            endLabel="Target"
            disabled={disabled}
          />
          <LabelsPicker
            options={references.initiativeOptions}
            value={references.initiativeIds}
            onToggle={references.onInitiativeToggle}
            placeholder={`Link ${initiativeNoun.toLowerCase()}s`}
            triggerIcon={<Target className="text-on-surface-variant size-4" />}
            searchPlaceholder={`Search ${initiativeNoun.toLowerCase()}s…`}
            emptyText={`No ${initiativeNoun.toLowerCase()}s`}
            ariaLabel={`${initiativeNoun}s`}
            disabled={disabled}
          />
        </>
      ) : null}
    </>
  );
}
