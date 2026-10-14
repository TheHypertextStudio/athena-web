/** Save an existing project as a process and start its recurrence through the current API. */
import { ProcessDefinitionId } from '@docket/work/ids';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import type { ProjectOut } from '@/lib/contracts/project';
import {
  AfterCompletionSchedule,
  CalendarProcessTrigger,
  type ProcessCreationMode,
} from '@/lib/contracts/recurrence';
import type { TaskRepeatDraft } from './repeat-task-control';

/** Inputs preserved from the reviewed repeat setup. */
export interface RepeatProjectMutationOptions {
  readonly orgId: string;
  readonly project: ProjectOut;
  readonly projectNoun: string;
  readonly creationMode: ProcessCreationMode;
  readonly repeat: TaskRepeatDraft;
  readonly effectiveFrom: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (seriesId: string) => void;
}

/** Mutation state and application-owned failure copy for the setup. */
export interface RepeatProjectMutation {
  readonly create: ReturnType<typeof useApiMutation<{ id: string }, undefined>>;
  readonly failure: string | null;
}

/** Keep partial-save failures in the setup while retaining shared mutation notices. */
export function useRepeatProjectMutation({
  orgId,
  project,
  projectNoun,
  creationMode,
  repeat,
  effectiveFrom,
  onOpenChange,
  onCreated,
}: RepeatProjectMutationOptions): RepeatProjectMutation {
  const [failure, setFailure] = useState<string | null>(null);
  const definitionSaved = useRef(false);
  const savedDefinition = useRef<{ key: string; definition: { id: string } } | null>(null);
  const definitionKey = JSON.stringify({
    orgId,
    projectId: project.id,
    name: project.name,
    creationMode,
  });
  const create = useApiMutation<{ id: string }, undefined>({
    mutationFn: async () => {
      setFailure(null);
      definitionSaved.current = false;
      if (!isValidProjectRepeat(repeat) || repeat.kind === 'none')
        throw new Error('Choose valid repeat settings.');
      const definition =
        savedDefinition.current?.key === definitionKey
          ? savedDefinition.current.definition
          : await createProjectDefinition({ orgId, project, projectNoun, creationMode });
      savedDefinition.current = { key: definitionKey, definition };
      definitionSaved.current = true;
      const trigger =
        repeat.kind === 'calendar'
          ? {
              kind: 'calendar' as const,
              schedule: repeat.schedule,
              missedPolicy: repeat.missedPolicy,
              materialization: repeat.materialization,
            }
          : {
              kind: 'after_completion' as const,
              interval: repeat.schedule.interval,
              unit: repeat.schedule.unit,
            };
      return unwrap(
        () =>
          api.v1.orgs[':orgId']['recurrence-series'].$post({
            param: { orgId },
            json: {
              processDefinitionId: ProcessDefinitionId.parse(definition.id),
              name: `${project.name} series`,
              trigger,
              effectiveFrom: repeat.kind === 'calendar' ? repeat.schedule.startDate : effectiveFrom,
            },
          }),
        `The reusable ${projectNoun.toLowerCase()} was saved, but its schedule could not be started.`,
      );
    },
    invalidateKeys: [queryKeys.processDefinitions(orgId), queryKeys.recurrenceSeries(orgId)],
    failureTitle: `Could not start this repeating ${projectNoun.toLowerCase()}.`,
    onError: () => {
      setFailure(
        definitionSaved.current
          ? `The reusable ${projectNoun.toLowerCase()} was saved, but its schedule could not be started.`
          : `Could not make this ${projectNoun.toLowerCase()} repeatable. Try again.`,
      );
    },
    onSuccess: (series) => {
      onOpenChange(false);
      onCreated(series.id);
    },
  });

  return { create, failure };
}

function createProjectDefinition({
  orgId,
  project,
  projectNoun,
  creationMode,
}: Pick<
  RepeatProjectMutationOptions,
  'orgId' | 'project' | 'projectNoun' | 'creationMode'
>): Promise<{ id: string }> {
  return unwrap(
    () =>
      api.v1.orgs[':orgId']['process-definitions']['from-project'].$post({
        param: { orgId },
        json: { projectId: project.id, name: `${project.name} series`, creationMode },
      }),
    `Could not make this ${projectNoun.toLowerCase()} repeatable.`,
  );
}

/** Validate every numeric cadence value through the existing API contracts. */
export function isValidProjectRepeat(repeat: TaskRepeatDraft): boolean {
  if (repeat.kind === 'calendar') return CalendarProcessTrigger.safeParse(repeat).success;
  return (
    repeat.kind === 'after_completion' && AfterCompletionSchedule.safeParse(repeat.schedule).success
  );
}
