'use client';

/**
 * Right-rail properties panel for the task detail view.
 *
 * @remarks
 * Renders the labelled property rows (project / program / milestone / cycle / estimate /
 * source / created) as a scrollable aside. All field pickers call back to the parent page
 * via {@link TaskPropertiesRailProps.onPatch}; read-only state and pending state are
 * controlled by the parent so the rail has no mutation state of its own.
 */
import type { TaskDetail } from '@docket/types';
import { EntityPicker, type PickerOption } from '@docket/ui/components';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { formatCalendarDate } from '@/lib/format-date';
import type { TaskPatch } from '@/lib/use-task-mutations';
import { PropertyRow } from './PropertyRow';

function formatDate(value: string | null | undefined): string {
  return formatCalendarDate(value) ?? '—';
}

/** Props for {@link TaskPropertiesRail}. */
export interface TaskPropertiesRailProps {
  task: TaskDetail;
  projectLabel: string;
  programLabel: string;
  cycleLabel: string;
  projectOptions: readonly PickerOption[];
  programOptions: readonly PickerOption[];
  milestoneOptions: readonly PickerOption[];
  cycleOptions: readonly PickerOption[];
  canEdit: boolean;
  propsPending: boolean;
  onPatch: (patch: TaskPatch) => void;
}

/**
 * Task properties sidebar — project, program, milestone, cycle, estimate, source, created.
 *
 * @param props - See {@link TaskPropertiesRailProps}.
 */
export function TaskPropertiesRail({
  task,
  projectLabel,
  programLabel,
  cycleLabel,
  projectOptions,
  programOptions,
  milestoneOptions,
  cycleOptions,
  canEdit,
  propsPending,
  onPatch,
}: TaskPropertiesRailProps): JSX.Element {
  const provenance = task.provenance;

  return (
    <aside
      aria-labelledby="properties-heading"
      className="border-outline-variant border-t pt-6 @4xl:border-t-0 @4xl:border-l @4xl:pt-0 @4xl:pl-6"
    >
      <h2 id="properties-heading" className="text-on-surface-variant mb-2 text-xs font-medium">
        Properties
      </h2>
      <div className="divide-outline-variant flex flex-col divide-y">
        <PropertyRow label={projectLabel}>
          <EntityPicker
            options={projectOptions}
            value={task.projectId ?? null}
            onChange={(projectId) => {
              onPatch({ projectId });
            }}
            placeholder={`Set ${projectLabel.toLowerCase()}`}
            clearLabel={`No ${projectLabel.toLowerCase()}`}
            searchPlaceholder={`Search ${projectLabel.toLowerCase()}s…`}
            ariaLabel={projectLabel}
            readOnly={!canEdit}
            disabled={propsPending}
          />
        </PropertyRow>

        <PropertyRow label={programLabel}>
          <EntityPicker
            options={programOptions}
            value={task.programId ?? null}
            onChange={(programId) => {
              onPatch({ programId });
            }}
            placeholder={`Set ${programLabel.toLowerCase()}`}
            clearLabel={`No ${programLabel.toLowerCase()}`}
            searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
            ariaLabel={programLabel}
            readOnly={!canEdit}
            disabled={propsPending}
          />
        </PropertyRow>

        <PropertyRow label="Milestone">
          <EntityPicker
            options={milestoneOptions}
            value={task.milestoneId ?? null}
            onChange={(milestoneId) => {
              onPatch({ milestoneId });
            }}
            placeholder={
              task.projectId ? 'Set milestone' : `Set a ${projectLabel.toLowerCase()} first`
            }
            clearLabel="No milestone"
            searchPlaceholder="Search milestones…"
            emptyText={
              task.projectId
                ? 'No milestones'
                : `Set a ${projectLabel.toLowerCase()} to choose a milestone`
            }
            ariaLabel="Milestone"
            readOnly={!canEdit || !task.projectId}
            disabled={propsPending}
          />
        </PropertyRow>

        <PropertyRow label={cycleLabel}>
          <EntityPicker
            options={cycleOptions}
            value={task.cycleId ?? null}
            onChange={(cycleId) => {
              onPatch({ cycleId });
            }}
            placeholder={`Set ${cycleLabel.toLowerCase()}`}
            clearLabel={`No ${cycleLabel.toLowerCase()}`}
            searchPlaceholder={`Search ${cycleLabel.toLowerCase()}s…`}
            ariaLabel={cycleLabel}
            readOnly={!canEdit}
            disabled={propsPending}
          />
        </PropertyRow>

        <PropertyRow label="Estimate">
          {typeof task.estimate === 'number' ? (
            <span>
              {task.estimate} {task.estimate === 1 ? 'point' : 'points'}
            </span>
          ) : (
            <span className="text-on-surface-variant">None</span>
          )}
        </PropertyRow>

        <PropertyRow label="Source">
          {provenance.source === 'linked' && provenance.externalUrl ? (
            <a
              href={provenance.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary focus-visible:ring-ring text-body-medium inline-flex items-center gap-1 rounded underline-offset-4 hover:underline focus-visible:ring-1 focus-visible:outline-none"
            >
              External link
            </a>
          ) : (
            <Badge variant="secondary">
              {provenance.source === 'linked' ? 'Linked' : 'Native'}
            </Badge>
          )}
        </PropertyRow>

        <PropertyRow label="Created">
          <span className="text-on-surface-variant">{formatDate(task.createdAt)}</span>
        </PropertyRow>
      </div>
    </aside>
  );
}
