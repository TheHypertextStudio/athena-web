'use client';

/**
 * The task's Overview tab: the description, then the work around it, then the conversation.
 *
 * @remarks
 * Ordered the way a person reads an issue. The description leads, directly under the masthead;
 * the subtasks and dependencies that break it down follow; the activity history and the comment
 * composer come last, where a reply belongs.
 */
import type { TaskDetail } from '@docket/work/task-model';
import { Button } from '@docket/ui/primitives';
import type { QueryKey } from '@tanstack/react-query';
import type { JSX } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { TaskRepeatingWorkBacklink } from '@/components/recurrence/repeating-work-backlink';
import { useAppRouter } from '@/lib/interactions/navigation';
import { useRenameTask } from '@/lib/use-rename-task';
import type { TaskMutations } from '@/lib/use-task-mutations';

import { Dependencies } from './Dependencies';
import { Subtasks } from './Subtasks';
import { TaskActivityFeed } from './task-activity-feed';
import { TaskDetails } from './task-details';

/** Props for {@link TaskOverviewPanel}. */
export interface TaskOverviewPanelProps {
  readonly orgId: string;
  readonly taskId: string;
  readonly task: TaskDetail;
  readonly currentActorId: string | null;
  readonly canEdit: boolean;
  readonly canComment: boolean;
  /** The name to show for a project id. */
  readonly projectName: (projectId: string) => string;
  readonly projectLabel: string;
  readonly mutations: Pick<
    TaskMutations,
    'patchTask' | 'addSubtask' | 'toggleSubtask' | 'addComment'
  >;
  /** The task's detail cache key, which a subtask rename re-reads. */
  readonly detailKey: QueryKey;
  /** Whether the request-owning linked content (backlink, dependency map) has been asked for. */
  readonly linkedContentOpen: boolean;
  readonly onOpenLinkedContent: () => void;
}

/** The linked content a person asks for: the repeating-work backlink and the dependency map. */
function LinkedContent({
  orgId,
  taskId,
  open,
  onOpen,
}: {
  readonly orgId: string;
  readonly taskId: string;
  readonly open: boolean;
  readonly onOpen: () => void;
}): JSX.Element {
  const router = useAppRouter();
  if (!open) {
    return (
      <section aria-label="Linked task content">
        <Button type="button" variant="outline" onClick={onOpen}>
          Load attachments and dependency map
        </Button>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-on-surface text-title-small">Dependency map</h2>
      <div className="bg-surface-container h-80 overflow-hidden rounded-xl">
        <TaskGraphPanel
          scope={{ orgId, rootTaskId: taskId, depth: 2 }}
          density="compact"
          onExpand={() => {
            router.push(`/orgs/${orgId}/graph?rootTaskId=${taskId}`);
          }}
        />
      </div>
    </section>
  );
}

/**
 * Render the Overview tab's content.
 *
 * @param props - See {@link TaskOverviewPanelProps}.
 * @returns the ordered overview sections.
 */
export function TaskOverviewPanel({
  orgId,
  taskId,
  task,
  currentActorId,
  canEdit,
  canComment,
  projectName,
  projectLabel,
  mutations,
  detailKey,
  linkedContentOpen,
  onOpenLinkedContent,
}: TaskOverviewPanelProps): JSX.Element {
  const router = useAppRouter();
  // Rename any subtask or dependency in place (an arbitrary task by id), then re-read this task's
  // detail so the refreshed titles flow back in.
  const onRenameTask = useRenameTask(orgId, [detailKey]);
  const onOpenTask = (id: string): void => {
    router.push(`/orgs/${orgId}/tasks/${id}`);
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {linkedContentOpen ? <TaskRepeatingWorkBacklink orgId={orgId} entityId={taskId} /> : null}
      <TaskDetails
        orgId={orgId}
        taskId={taskId}
        task={task}
        currentActorId={currentActorId}
        canEdit={canEdit}
        onSave={(description) => {
          mutations.patchTask({ description: description ?? '' });
        }}
      />
      <Subtasks
        organizationId={orgId}
        parentTaskId={taskId}
        subtasks={task.subtasks}
        onAdd={mutations.addSubtask}
        onToggle={(subtask, done) => mutations.toggleSubtask(subtask.id, done)}
        onOpen={onOpenTask}
        onRename={onRenameTask}
        canEdit={canEdit}
      />
      <Dependencies
        blocking={task.blocking}
        blockedBy={task.blockedBy}
        projectName={projectName}
        projectLabel={projectLabel}
        onOpen={onOpenTask}
        canEdit={canEdit}
        onRename={onRenameTask}
      />
      <LinkedContent
        orgId={orgId}
        taskId={taskId}
        open={linkedContentOpen}
        onOpen={onOpenLinkedContent}
      />
      <TaskActivityFeed
        orgId={orgId}
        taskId={taskId}
        onComment={mutations.addComment}
        canComment={canComment}
      />
    </div>
  );
}
