'use client';

/**
 * One row in the Triage queue.
 *
 * @remarks
 * Composes the design-system {@link ListRow} + {@link ListCell} primitives (rather than the
 * canned {@link TaskRow} preset) because a Triage row carries two extra affordances a plain
 * task row does not: a leading-metadata {@link SourceTag | provenance pill} (native vs
 * linked-from-a-provider — the first thing a triager reads) and a trailing
 * {@link TriageActions | sort-it menu}. The row still reads like every other Docket list row:
 * a leading {@link StatusIcon} colored by the task's workflow-state *type*, the title, then
 * the assignee. Activating the row (click / Enter) opens the task detail; the source link and
 * the action trigger both stop propagation so they never hijack that activation.
 */
import type { TaskProvenance } from '@docket/types';
import {
  ActorAvatar,
  ListCell,
  ListRow,
  StatusIcon,
  type WorkflowStateType,
} from '@docket/ui/components';
import type { JSX } from 'react';

import { SourceTag } from './source-tag';
import { TriageActions, type TriageDestination } from './triage-actions';

/** The view-model one Triage row renders. */
export interface TriageRowData {
  /** Stable task id. */
  id: string;
  /** Task title. */
  title: string;
  /** The canonical workflow-state type driving the leading {@link StatusIcon}. */
  stateType: WorkflowStateType;
  /** The task's provenance triple (drives the {@link SourceTag}). */
  provenance: TaskProvenance;
  /** The assignee's display name, or `null` when unassigned. */
  assigneeName: string | null;
  /** The assignee's avatar URL, when known. */
  assigneeAvatarUrl?: string | null;
}

/** Props for {@link TriageRow}. */
export interface TriageRowProps {
  /** The row's view-model. */
  task: TriageRowData;
  /** Whether this row is the active (keyboard-focused) row. */
  active?: boolean;
  /** Activate (open) the task detail. */
  onActivate?: () => void;
  /** Whether a sort/dismiss mutation for this row is in flight. */
  busy?: boolean;
  /** The org's projects, offered as move-to destinations. */
  projects: readonly TriageDestination[];
  /** The org's programs, offered as send-to destinations. */
  programs: readonly TriageDestination[];
  /** Vocabulary-resolved singular noun for a project. */
  projectNoun: string;
  /** Vocabulary-resolved singular noun for a program. */
  programNoun: string;
  /** Resolve a stored integration `provider` slug to its friendly display name. */
  providerName: (provider: string | null | undefined) => string;
  /** Assign this task to the project with the given id. */
  onAssignProject: (projectId: string) => void;
  /** Send this task to the program with the given id. */
  onAssignProgram: (programId: string) => void;
  /** Dismiss (archive) this task out of the queue. */
  onDismiss: () => void;
}

/**
 * A single Triage queue row: status, title, provenance, assignee, and the sort-it menu.
 *
 * @example
 * ```tsx
 * <TriageRow
 *   task={row}
 *   active={ctx.active}
 *   onActivate={ctx.onActivate}
 *   projects={projects}
 *   programs={programs}
 *   projectNoun="Project"
 *   programNoun="Program"
 *   providerName={providerName}
 *   onAssignProject={(id) => sortToProject(row.id, id)}
 *   onAssignProgram={(id) => sortToProgram(row.id, id)}
 *   onDismiss={() => dismiss(row.id)}
 * />
 * ```
 */
export function TriageRow({
  task,
  active,
  onActivate,
  busy = false,
  projects,
  programs,
  projectNoun,
  programNoun,
  providerName,
  onAssignProject,
  onAssignProgram,
  onDismiss,
}: TriageRowProps): JSX.Element {
  return (
    <ListRow active={active} onActivate={onActivate}>
      <ListCell className="shrink-0">
        <StatusIcon type={task.stateType} />
      </ListCell>

      <ListCell className="min-w-0 flex-1">
        <span className="text-on-surface truncate">{task.title}</span>
      </ListCell>

      <ListCell className="shrink-0">
        <SourceTag provenance={task.provenance} providerName={providerName} />
      </ListCell>

      {task.assigneeName ? (
        <ListCell className="shrink-0">
          <ActorAvatar kind="human" name={task.assigneeName} avatarUrl={task.assigneeAvatarUrl} />
        </ListCell>
      ) : null}

      <ListCell className="shrink-0">
        <TriageActions
          projects={projects}
          programs={programs}
          projectNoun={projectNoun}
          programNoun={programNoun}
          busy={busy}
          onAssignProject={onAssignProject}
          onAssignProgram={onAssignProgram}
          onDismiss={onDismiss}
        />
      </ListCell>
    </ListRow>
  );
}
