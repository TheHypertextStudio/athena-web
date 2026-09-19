'use client';

/**
 * The pieces the task page hands to `EntityDetailLayout`'s slots.
 *
 * @remarks
 * Each is a small component rather than inline JSX so the page composes the layout in one screen
 * and each slot can hold its own hooks: the glyph reads and writes its own display record, the
 * print summary resolves its own status name.
 */
import type { MemberOut } from '@docket/identity-access/member-contract';
import type { TaskDetail } from '@docket/work/task-model';
import { Tabs } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { useEntityDisplay } from '@/components/entity-display/use-entity-display';
import { useWorkStatus } from '@/components/entity-display/use-work-status';
import { DetailPrintSummary } from '@/components/views/detail-print-summary';
import { formatCalendarDate } from '@/lib/format-date';
import type { TaskPatch } from '@/lib/use-task-mutations';

/** The task page's sections, Overview first. */
export type TaskTab = 'overview' | 'resources';

/** The section ids in tab order, as `useDetailTab` reads them. */
export const TASK_TABS = ['overview', 'resources'] as const;

/** Props for {@link TaskIcon}. */
export interface TaskIconProps {
  readonly orgId: string;
  readonly taskId: string;
  readonly title: string;
  readonly canEdit: boolean;
}

/**
 * The task's glyph: its icon and colour, editable by anyone who can edit the task.
 *
 * @param props - See {@link TaskIconProps}.
 * @returns the masthead's 48px icon picker.
 */
export function TaskIcon({ orgId, taskId, title, canEdit }: TaskIconProps): JSX.Element {
  const entityDisplay = useEntityDisplay({
    organizationId: orgId,
    subjectType: 'task',
    subjectId: taskId,
    errorMessage: 'Could not load this task’s icon.',
  });
  return (
    <EntityIconPicker
      display={entityDisplay.display}
      workspaceId={orgId}
      entityName={title}
      editable={canEdit}
      pending={entityDisplay.mutation.isPending}
      loading={entityDisplay.loading}
      size={48}
      onChange={(glyph, colorKey, customColor) => {
        entityDisplay.mutation.mutate({ glyph, colorKey, customColor });
      }}
    />
  );
}

/** Props for {@link TaskTitle}. */
export interface TaskTitleProps {
  readonly title: string;
  readonly canEdit: boolean;
  readonly onPatch: (patch: TaskPatch) => void;
}

/**
 * The task's title, edited in place. The layout owns its type, so it carries no size class.
 *
 * @param props - See {@link TaskTitleProps}.
 * @returns the inline-editable title.
 */
export function TaskTitle({ title, canEdit, onPatch }: TaskTitleProps): JSX.Element {
  return (
    <EditableTitle
      value={title}
      onSave={(next) => {
        onPatch({ title: next });
      }}
      canEdit={canEdit}
      ariaLabel="Task title"
    />
  );
}

/** Props for {@link TaskTabs}. */
export interface TaskTabsProps {
  readonly tab: TaskTab;
  readonly onTabChange: (tab: TaskTab) => void;
}

/**
 * The task page's underline tab bar.
 *
 * @param props - See {@link TaskTabsProps}.
 * @returns the tab bar, which overflows into a named menu when the pane is narrow.
 */
export function TaskTabs({ tab, onTabChange }: TaskTabsProps): JSX.Element {
  return (
    <Tabs
      variant="underline"
      value={tab}
      onValueChange={(value) => {
        onTabChange(value as TaskTab);
      }}
      label="Task sections"
      overflow={{ menuLabel: 'More Task sections' }}
      items={[
        { value: 'overview', label: 'Overview', priority: 0 },
        { value: 'resources', label: 'Resources', priority: 1 },
      ]}
    />
  );
}

/** Props for {@link TaskPrintSummary}. */
export interface TaskPrintSummaryProps {
  readonly task: TaskDetail;
  /** The roster the assignee is named from; empty before it loads. */
  readonly members: readonly MemberOut[];
  /** The project's name, or `null` for a task in none. */
  readonly projectName: string | null;
}

/**
 * The static brief the task prints as, in place of its interactive page.
 *
 * @param props - See {@link TaskPrintSummaryProps}.
 * @returns the printable summary with status, priority, assignee, project, due date, and estimate.
 */
export function TaskPrintSummary({
  task,
  members,
  projectName,
}: TaskPrintSummaryProps): JSX.Element {
  const status = useWorkStatus('task', task.state);
  const assignee = members.find((member) => member.actorId === task.assigneeId);
  return (
    <DetailPrintSummary
      title={task.title}
      description={task.description}
      properties={[
        { label: 'Status', value: status.name },
        { label: 'Priority', value: task.priority },
        { label: 'Assignee', value: assignee?.displayName ?? '—' },
        { label: 'Project', value: projectName ?? '—' },
        { label: 'Due', value: formatCalendarDate(task.dueDate) ?? '—' },
        { label: 'Estimate', value: task.estimate?.toString() ?? '—' },
      ]}
    />
  );
}
