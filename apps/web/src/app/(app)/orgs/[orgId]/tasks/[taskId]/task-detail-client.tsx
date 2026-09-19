'use client';

import type { TaskDetail } from '@docket/work/task-model';
import { useVocabulary } from '@docket/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useEffect, useState } from 'react';

import { TaskActions } from '@/components/task-detail/task-actions';
import { TaskBreadcrumb } from '@/components/task-detail/task-breadcrumb';
import { TaskDeleteDialog, useTaskDeletePrompt } from '@/components/task-detail/task-delete-dialog';
import {
  TaskDetailFallback,
  resolveTaskDetailView,
  type TaskTerminalState,
} from '@/components/task-detail/task-detail-states';
import {
  TASK_TABS,
  TaskIcon,
  TaskPrintSummary,
  TaskTabs,
  TaskTitle,
  type TaskTab,
} from '@/components/task-detail/task-masthead-slots';
import { TaskMetadataRow } from '@/components/task-detail/task-masthead-properties';
import { TaskSections } from '@/components/task-detail/task-sections';
import { useTaskPropertyModel } from '@/components/task-detail/use-task-property-model';
import { useTaskRosters } from '@/components/task-detail/use-task-rosters';
import { EntityDetailLayout } from '@/components/views/entity-detail-layout';
import { useDetailTab } from '@/components/views/use-detail-tab';
import { useTypedRoute } from '@/lib/app-location';
import {
  removeNavigationSnapshot,
  seedNavigationSnapshot,
} from '@/lib/navigation-snapshot-runtime';
import { useNavigationSnapshot } from '@/lib/use-navigation-snapshot';
import { type TaskDetailData, useTaskDetail } from '@/lib/use-task-detail';
import { useTaskMutations } from '@/lib/use-task-mutations';

import { useTaskPageIdentity } from './use-task-page-identity';

/** Props for {@link TaskDetailReady}: a task is in hand and every slot can render from it. */
interface TaskDetailReadyProps {
  readonly orgId: string;
  readonly task: TaskDetail;
  readonly detail: TaskDetailData;
  readonly tab: TaskTab;
  readonly onTabChange: (tab: TaskTab) => void;
  readonly linkedContentOpen: boolean;
  readonly onOpenLinkedContent: () => void;
}

/** The task page once its task has loaded: masthead, tabs, the active section, and the delete prompt. */
function TaskDetailReady({
  orgId,
  task,
  detail,
  tab,
  onTabChange,
  linkedContentOpen,
  onOpenLinkedContent,
}: TaskDetailReadyProps): JSX.Element {
  const projectLabel = useVocabulary('project');
  const canEdit = detail.capabilities?.contribute ?? false;
  const mutations = useTaskMutations(orgId, task.id, detail.detailKey, detail.activityKey);
  const deletePrompt = useTaskDeletePrompt(mutations.resetDelete);
  const rosters = useTaskRosters(orgId, task);
  const { model, projectName } = useTaskPropertyModel({
    orgId,
    task,
    canEdit,
    workflowStates: detail.workflowStates,
    rosters,
    mutations,
  });
  const project = task.projectId ? projectName(task.projectId) : null;

  return (
    <>
      <EntityDetailLayout
        object={{ kind: 'task', id: task.id, organizationId: orgId, title: task.title }}
        printSummary={
          <TaskPrintSummary task={task} members={rosters.members} projectName={project} />
        }
        eyebrow={
          <TaskBreadcrumb
            orgId={orgId}
            projectId={task.projectId ?? null}
            projectName={project ?? projectLabel}
            projectLabel={projectLabel}
            parentTaskId={task.parentTaskId ?? null}
          />
        }
        icon={<TaskIcon orgId={orgId} taskId={task.id} title={task.title} canEdit={canEdit} />}
        title={<TaskTitle title={task.title} canEdit={canEdit} onPatch={mutations.patchTask} />}
        metadata={<TaskMetadataRow model={model} />}
        actions={
          <TaskActions
            task={task}
            memberOptions={model.memberOptions}
            canEdit={canEdit}
            canManage={detail.capabilities?.manage ?? false}
            mutations={mutations}
            deletePrompt={deletePrompt}
          />
        }
        tabs={<TaskTabs tab={tab} onTabChange={onTabChange} />}
      >
        <TaskSections
          tab={tab}
          orgId={orgId}
          task={task}
          detailKey={detail.detailKey}
          currentActorId={detail.currentActorId}
          canEdit={canEdit}
          canComment={detail.capabilities?.comment ?? false}
          mentions={detail.entityMentions}
          projectName={projectName}
          projectLabel={projectLabel}
          mutations={mutations}
          linkedContentOpen={linkedContentOpen}
          onOpenLinkedContent={onOpenLinkedContent}
        />
      </EntityDetailLayout>
      <TaskDeleteDialog orgId={orgId} prompt={deletePrompt} mutations={mutations} />
    </>
  );
}

/** TaskDetailPage renders the authenticated task page. */
export default function TaskDetailPage(): JSX.Element {
  const { params } = useTypedRoute('/orgs/[orgId]/tasks/[taskId]');
  const { orgId, taskId } = params;
  const queryClient = useQueryClient();
  const { tab, setTab } = useDetailTab<TaskTab>(TASK_TABS);
  const navigationSnapshot = useNavigationSnapshot('task', taskId);
  const [aggregateEnabled, setAggregateEnabled] = useState(true);
  const [terminalState, setTerminalState] = useState<TaskTerminalState | null>(null);
  const [linkedContentOpen, setLinkedContentOpen] = useState(false);
  const detail = useTaskDetail(orgId, taskId, {
    aggregateEnabled,
    resourcesOpen: tab === 'resources',
  });
  const { task, snapshot, detailKey, terminalFailure } = detail;

  useTaskPageIdentity(orgId, taskId, task?.title ?? navigationSnapshot?.title);

  useEffect(() => {
    setAggregateEnabled(true);
    setTerminalState(null);
    setLinkedContentOpen(false);
  }, [taskId]);

  useEffect(() => {
    if (snapshot) seedNavigationSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (terminalFailure === null) return;
    setTerminalState(terminalFailure);
    setAggregateEnabled(false);
    void removeNavigationSnapshot('task', taskId);
    queryClient.removeQueries({ queryKey: detailKey, exact: true });
  }, [detailKey, queryClient, taskId, terminalFailure]);

  const view = resolveTaskDetailView({
    isPending: detail.isPending,
    terminalState,
    isError: detail.taskQuery.isError,
    hasTask: task !== null,
  });
  if (view === 'ready' && task !== null) {
    return (
      <TaskDetailReady
        orgId={orgId}
        task={task}
        detail={detail}
        tab={tab}
        onTabChange={setTab}
        linkedContentOpen={linkedContentOpen}
        onOpenLinkedContent={() => {
          setLinkedContentOpen(true);
        }}
      />
    );
  }
  return (
    <TaskDetailFallback
      view={view}
      orgId={orgId}
      terminalState={terminalState}
      snapshot={navigationSnapshot}
      query={detail.taskQuery}
    />
  );
}
