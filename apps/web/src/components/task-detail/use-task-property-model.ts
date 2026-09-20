'use client';

/**
 * Assemble everything the task's property pickers read into one {@link TaskPropertyModel}.
 *
 * @remarks
 * The page hands this hook the task, its capability, the rosters, and the mutations, and gets back
 * the picker options, the loading and open handlers for each roster, the delegate resolved for
 * display, and the callbacks that write. The masthead's chips and the docked aside both render from
 * the same model, so a property offers the same choices wherever it is shown.
 */
import type { Priority } from '@docket/work/task-contract';
import type { TaskDetail } from '@docket/work/task-model';
import type { WorkflowState } from '@docket/work/workflow';
import type {
  EntityDisplayOut,
  EntityDisplaySubjectType,
} from '@docket/work/entity-display-contract';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { useCallback, useMemo } from 'react';

import { labelsDef, useCreateLabel } from '@/components/labels/queries';
import {
  labelOptions as toLabelOptions,
  memberActorOptions,
  milestoneOptions as toMilestoneOptions,
  programOptions as toProgramOptions,
  projectOptions as toProjectOptions,
} from '@/components/pickers/options';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { useEstimationScale } from '@/lib/use-estimation-scale';
import type { TaskMutations } from '@/lib/use-task-mutations';

import type { TaskPropertyModel } from './task-masthead-properties';
import type { TaskDelegate } from './task-secondary-properties';
import { NO_ITEMS, type TaskRosters } from './use-task-rosters';

/** What {@link useTaskPropertyModel} builds the model from. */
export interface TaskPropertyModelInput {
  readonly orgId: string;
  readonly task: TaskDetail;
  readonly canEdit: boolean;
  readonly workflowStates: readonly WorkflowState[] | null;
  readonly rosters: TaskRosters;
  readonly mutations: Pick<
    TaskMutations,
    'setState' | 'setPriority' | 'patchTask' | 'statusPending' | 'priorityPending'
  >;
}

/** What {@link useTaskPropertyModel} returns. */
export interface TaskPropertyModelResult {
  readonly model: TaskPropertyModel;
  /** The name to show for a project id, falling back to the workspace's noun for one. */
  readonly projectName: (projectId: string) => string;
}

/**
 * The workspace's per-entity icon overrides for one kind of subject, read for picker options.
 *
 * @param enabled - Whether the roster these icons decorate is switched on; a dormant roster has no
 * options to decorate.
 */
function useEntityDisplays(
  orgId: string,
  subjectType: EntityDisplaySubjectType,
  enabled: boolean,
): readonly EntityDisplayOut[] {
  const query = useApiListQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, subjectType),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType },
          query: { limit: '100' },
        }),
      `Could not load ${subjectType} icons.`,
      { enabled },
    ),
  );
  return query.data?.items ?? NO_ITEMS;
}

/** Resolve the delegate's display name and avatar from the member and agent rosters. */
function useDelegate(task: TaskDetail, rosters: TaskRosters): TaskDelegate | null {
  const { members, agents } = rosters;
  return useMemo(() => {
    if (!task.delegateId) return null;
    const member = members.find((m) => m.actorId === task.delegateId);
    if (member) return { name: member.displayName, kind: 'human', avatarUrl: member.avatar };
    if (agents.some((a) => a.actorId === task.delegateId)) return { name: 'Agent', kind: 'agent' };
    return { name: 'Unknown', kind: 'human' };
  }, [agents, members, task.delegateId]);
}

/** The picker options, built from the rosters and the workspace's icon overrides. */
function useTaskPickerOptions(orgId: string, task: TaskDetail, rosters: TaskRosters) {
  const { members, projects, programs, milestones, wanted } = rosters;
  const projectDisplays = useEntityDisplays(orgId, 'project', wanted.projects);
  const milestoneDisplays = useEntityDisplays(orgId, 'milestone', wanted.milestones);
  const labelsQ = useApiListQuery(labelsDef(orgId));
  return {
    memberOptions: useMemo(() => memberActorOptions(members), [members]),
    projectOptions: useMemo(
      () => toProjectOptions(projects, projectDisplays),
      [projectDisplays, projects],
    ),
    programOptions: useMemo(() => toProgramOptions(programs), [programs]),
    // Milestones are scoped to the task's own project: the server refuses one from any other, so
    // a wider list could only offer choices that cannot be saved.
    milestoneOptions: useMemo(
      () =>
        toMilestoneOptions(
          milestones.filter((milestone) => milestone.projectId === task.projectId),
          milestoneDisplays,
        ),
      [milestoneDisplays, milestones, task.projectId],
    ),
    labelOptions: useMemo<readonly PickerOption[]>(
      () => toLabelOptions(labelsQ.data?.items ?? NO_ITEMS),
      [labelsQ.data],
    ),
  };
}

/**
 * Build the property model for the task on screen.
 *
 * @param input - See {@link TaskPropertyModelInput}.
 * @returns the model and the project-name lookup that shares its rosters.
 */
export function useTaskPropertyModel({
  orgId,
  task,
  canEdit,
  workflowStates,
  rosters,
  mutations,
}: TaskPropertyModelInput): TaskPropertyModelResult {
  const projectLabel = useVocabulary('project');
  const programLabel = useVocabulary('program');
  const cycleLabel = useVocabulary('cycle');
  const options = useTaskPickerOptions(orgId, task, rosters);
  const delegate = useDelegate(task, rosters);
  const { scale: estimationScale } = useEstimationScale(orgId);
  const createLabel = useCreateLabel(orgId);
  const { patchTask, setState, setPriority } = mutations;

  // Inline creation attaches as it creates: the name was typed into *this* task's picker, so
  // leaving the person to find and tick it afterwards would be a second step nobody asked for.
  const onCreateLabel = useCallback(
    (name: string): void => {
      createLabel.mutate(
        { name },
        {
          onSuccess: (created) => {
            patchTask({ labels: [...task.labels.map((l) => l.id), created.id] });
          },
        },
      );
    },
    [createLabel, patchTask, task.labels],
  );
  const projectName = useCallback(
    (projectId: string): string =>
      rosters.projects.find((p) => p.id === projectId)?.name ?? projectLabel,
    [projectLabel, rosters.projects],
  );

  const model: TaskPropertyModel = {
    task,
    canEdit,
    workflowStates,
    statusPending: mutations.statusPending,
    priorityPending: mutations.priorityPending,
    onSetState: (stateKey: string) => void setState(stateKey),
    onSetPriority: (priority: Priority) => void setPriority(priority),
    onPatch: patchTask,
    memberOptions: options.memberOptions,
    membersLoading: rosters.loading.members,
    onMembersOpenChange: rosters.onOpenChange.members,
    projectLabel,
    projectOptions: options.projectOptions,
    projectLoading: rosters.loading.projects,
    onProjectOpenChange: rosters.onOpenChange.projects,
    secondary: {
      programLabel,
      cycleLabel,
      programOptions: options.programOptions,
      milestoneOptions: options.milestoneOptions,
      labelOptions: options.labelOptions,
      programLoading: rosters.loading.programs,
      milestoneLoading: rosters.loading.milestones,
      onProgramOpenChange: rosters.onOpenChange.programs,
      onMilestoneOpenChange: rosters.onOpenChange.milestones,
      onCreateLabel,
      estimationScale,
      delegate,
    },
  };
  return { model, projectName };
}
