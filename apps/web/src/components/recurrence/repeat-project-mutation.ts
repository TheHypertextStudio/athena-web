/** Save an existing project as a process and start its recurrence through the current API. */
import { ProcessDefinitionId } from '@docket/work/ids';
import { useRef, useState, type RefObject } from 'react';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import type { ProjectOut } from '@/lib/contracts/project';
import {
  AfterCompletionSchedule,
  CalendarProcessTrigger,
  type ProcessCreationMode,
  type ProcessTrigger,
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
  const scheduleRequest = useRef<RequestIdentity | null>(null);
  const definitionRequest = useRef<RequestIdentity | null>(null);
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
          : await createProjectDefinition({
              orgId,
              project,
              projectNoun,
              creationMode,
              requestKey: stableRequestKey(definitionRequest, definitionKey),
            });
      savedDefinition.current = { key: definitionKey, definition };
      definitionSaved.current = true;
      const json = {
        processDefinitionId: ProcessDefinitionId.parse(definition.id),
        name: `${project.name} series`,
        trigger: projectRepeatTrigger(repeat),
        effectiveFrom: repeat.kind === 'calendar' ? repeat.schedule.startDate : effectiveFrom,
      };
      const payload = JSON.stringify({ orgId, json });
      const requestKey = stableRequestKey(scheduleRequest, payload);
      return unwrap(
        () =>
          api.v1.orgs[':orgId']['recurrence-series'].$post(
            { param: { orgId }, json },
            { headers: { 'Idempotency-Key': requestKey } },
          ),
        `The reusable ${projectNoun.toLowerCase()} was saved. Could not finish setting up this repeating ${projectNoun.toLowerCase()}. Try again.`,
      );
    },
    invalidateKeys: [queryKeys.processDefinitions(orgId), queryKeys.recurrenceSeries(orgId)],
    failureTitle: 'Could not finish setup',
    onError: () => {
      setFailure(
        definitionSaved.current
          ? `The reusable ${projectNoun.toLowerCase()} was saved. Could not finish setting up this repeating ${projectNoun.toLowerCase()}. Try again.`
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
  requestKey,
}: Pick<RepeatProjectMutationOptions, 'orgId' | 'project' | 'projectNoun' | 'creationMode'> & {
  readonly requestKey: string;
}): Promise<{ id: string }> {
  return unwrap(
    () =>
      api.v1.orgs[':orgId']['process-definitions']['from-project'].$post(
        {
          param: { orgId },
          json: { projectId: project.id, name: `${project.name} series`, creationMode },
        },
        { headers: { 'Idempotency-Key': requestKey } },
      ),
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

function projectRepeatTrigger(
  repeat: Exclude<TaskRepeatDraft, { readonly kind: 'none' }>,
): ProcessTrigger {
  if (repeat.kind === 'calendar') return repeat;
  return {
    kind: 'after_completion',
    interval: repeat.schedule.interval,
    unit: repeat.schedule.unit,
  };
}

interface RequestIdentity {
  readonly payload: string;
  readonly key: string;
}

function stableRequestKey(identity: RefObject<RequestIdentity | null>, payload: string): string {
  if (identity.current?.payload !== payload) {
    identity.current = { payload, key: crypto.randomUUID() };
  }
  return identity.current.key;
}
