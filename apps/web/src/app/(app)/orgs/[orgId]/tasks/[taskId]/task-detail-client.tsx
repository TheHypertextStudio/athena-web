'use client';

import type { TaskDetail } from '@docket/work/task-model';
import { useVocabulary } from '@docket/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useEffect, useState } from 'react';

import { TaskActions } from '@/components/task-detail/task-actions';
import { TaskBreadcrumb } from '@/components/task-detail/task-breadcrumb';
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
import { TaskPaletteCommands } from '@/components/task-detail/task-palette-commands';
import { TaskPropertiesPanel } from '@/components/task-detail/task-properties-panel';
import { TaskRelationsProvider } from '@/components/task-detail/task-relation-commands';
import { TaskSections } from '@/components/task-detail/task-sections';
import { useDescriptionExpansion } from '@/components/task-detail/use-description-expansion';
import { useTaskPropertyModel } from '@/components/task-detail/use-task-property-model';
import { useTaskRosters } from '@/components/task-detail/use-task-rosters';
import { EntityDetailLayout } from '@/components/views/entity-detail-layout';
import { useDetailTab } from '@/components/views/use-detail-tab';
import { taskObjectRef } from '@/lib/actions';
import { useTypedRoute } from '@/lib/app-location';
import {
  removeNavigationSnapshot,
  seedNavigationSnapshot,
} from '@/lib/navigation-snapshot-runtime';
import { useNavigationSnapshot } from '@/lib/use-navigation-snapshot';
import { type TaskDetailData, useTaskDetail } from '@/lib/use-task-detail';
import { useTaskMutations } from '@/lib/use-task-mutations';
import { useTaskRelations } from '@/lib/use-task-relations';

import { useTaskPageIdentity } from './use-task-page-identity';

/** Props for {@link TaskDetailReady}: a task is in hand and every slot can render from it. */
interface TaskDetailReadyProps {
  readonly orgId: string;
  readonly task: TaskDetail;
  readonly detail: TaskDetailData;
  readonly tab: TaskTab;
  readonly onTabChange: (tab: TaskTab) => void;
}

/** The task page once its task has loaded: masthead, tabs, and the active section. */
function TaskDetailReady({
  orgId,
  task,
  detail,
  tab,
  onTabChange,
}: TaskDetailReadyProps): JSX.Element {
  const projectLabel = useVocabulary('project');
  const canEdit = detail.capabilities?.contribute ?? false;
  const mutations = useTaskMutations(orgId, task.id, detail.detailKey, detail.activityKey);
  const expansion = useDescriptionExpansion(orgId, task.id);
  const rosters = useTaskRosters(orgId, task);
  const relationWrites = useTaskRelations(orgId, task.id, detail.detailKey);
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
    <TaskRelationsProvider writes={relationWrites}>
      <EntityDetailLayout
        object={taskObjectRef(task, orgId)}
        printSummary={
          <TaskPrintSummary task={task} members={rosters.members} projectName={project} />
        }
        eyebrow={
          <TaskBreadcrumb
            orgId={orgId}
            projectId={task.projectId ?? null}
            projectName={project}
            projectLabel={projectLabel}
            parentTaskId={task.parentTaskId ?? null}
          />
        }
        icon={<TaskIcon orgId={orgId} taskId={task.id} title={task.title} canEdit={canEdit} />}
        title={<TaskTitle title={task.title} canEdit={canEdit} onPatch={mutations.patchTask} />}
        metadata={
          <>
            <TaskPaletteCommands canEdit={canEdit} tab={tab} onTabChange={onTabChange} />
            <TaskMetadataRow model={model} />
          </>
        }
        aside={<TaskPropertiesPanel model={model} />}
        actions={
          <TaskActions
            orgId={orgId}
            task={task}
            canEdit={canEdit}
            canManage={detail.capabilities?.manage ?? false}
            mutations={mutations}
            expansion={expansion}
          />
        }
        tabs={<TaskTabs tab={tab} onTabChange={onTabChange} />}
      >
        <TaskSections
          tab={tab}
          orgId={orgId}
          task={task}
          currentActorId={detail.currentActorId}
          canEdit={canEdit}
          canComment={detail.capabilities?.comment ?? false}
          mentions={detail.entityMentions}
          projectName={projectName}
          mutations={mutations}
          expansion={expansion}
        />
      </EntityDetailLayout>
    </TaskRelationsProvider>
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
  const detail = useTaskDetail(orgId, taskId, {
    aggregateEnabled,
    resourcesOpen: tab === 'resources',
  });
  const { task, snapshot, detailKey, terminalFailure } = detail;

  useTaskPageIdentity(orgId, taskId, task?.title ?? navigationSnapshot?.title);

  useEffect(() => {
    setAggregateEnabled(true);
    setTerminalState(null);
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

  const resolution = resolveTaskDetailView({
    isPending: detail.isPending,
    terminalState,
    isError: detail.taskQuery.isError,
    task,
  });
  if (resolution.kind === 'ready') {
    return (
      <TaskDetailReady
        orgId={orgId}
        task={resolution.task}
        detail={detail}
        tab={tab}
        onTabChange={setTab}
      />
    );
  }
  return (
    <TaskDetailFallback
      view={resolution.view}
      orgId={orgId}
      terminalState={terminalState}
      snapshot={navigationSnapshot}
      query={detail.taskQuery}
    />
  );
}
