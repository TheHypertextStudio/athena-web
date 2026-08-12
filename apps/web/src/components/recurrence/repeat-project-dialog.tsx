'use client';

/** Focused setup for turning an existing Project into a repeating process. */
import type { MilestoneOut, ProcessCreationMode, ProjectOut } from '@docket/types';
import { ProcessDefinitionId } from '@docket/types';
import { todayIso } from '@docket/ui/components';
import { Check, FolderKanban, RefreshCw } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import type { MilestoneTask } from '@/components/project-detail/milestone-tasks';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

import {
  createDefaultTaskRepeat,
  RepeatTaskControl,
  type TaskRepeatDraft,
} from './repeat-task-control';

/** Props for {@link RepeatProjectDialog}. */
export interface RepeatProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly orgId: string;
  readonly project: ProjectOut;
  readonly milestones: readonly MilestoneOut[];
  readonly tasks: readonly MilestoneTask[];
  readonly projectNoun: string;
  readonly onCreated: (seriesId: string) => void;
}

/** Focused review of included work, release behavior, and cadence before a project repeats. */
export function RepeatProjectDialog({
  open,
  onOpenChange,
  orgId,
  project,
  milestones,
  tasks,
  projectNoun,
  onCreated,
}: RepeatProjectDialogProps): JSX.Element {
  const today = todayIso();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const defaultStart = project.startDate?.slice(0, 10) ?? today;
  const [creationMode, setCreationMode] = useState<ProcessCreationMode>('all_at_once');
  const [repeat, setRepeat] = useState<TaskRepeatDraft>(() =>
    createDefaultTaskRepeat('monthly', defaultStart, timezone),
  );
  const milestoneName = useMemo<ReadonlyMap<string, string>>(
    () => new Map<string, string>(milestones.map((milestone) => [milestone.id, milestone.name])),
    [milestones],
  );

  const create = useApiMutation<{ id: string }, undefined>({
    mutationFn: async () => {
      if (repeat.kind === 'none') throw new Error('Choose when this project should repeat.');
      const definition = await unwrap(
        () =>
          api.v1.orgs[':orgId']['process-definitions']['from-project'].$post({
            param: { orgId },
            json: {
              projectId: project.id,
              name: `${project.name} series`,
              creationMode,
            },
          }),
        `Could not make this ${projectNoun.toLowerCase()} repeatable.`,
      );
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
              effectiveFrom: repeat.kind === 'calendar' ? repeat.schedule.startDate : defaultStart,
            },
          }),
        `The reusable ${projectNoun.toLowerCase()} was saved, but its schedule could not be started.`,
      );
    },
    invalidateKeys: [queryKeys.processDefinitions(orgId), queryKeys.recurrenceSeries(orgId)],
    onSuccess: (series) => {
      onOpenChange(false);
      onCreated(series.id);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-outline-variant border-b px-6 py-5">
          <DialogTitle>Repeat this {projectNoun.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Docket will use this work as the starting shape for each new occurrence. The current
            {` ${projectNoun.toLowerCase()} `}stays unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 px-6 py-5">
          <section className="flex flex-col gap-3" aria-labelledby="included-work-heading">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id="included-work-heading" className="text-title-small text-on-surface">
                  Work included
                </h3>
                <p className="text-body-small text-on-surface-variant">
                  One {projectNoun.toLowerCase()}, {milestones.length} milestone
                  {milestones.length === 1 ? '' : 's'}, and {tasks.length} task
                  {tasks.length === 1 ? '' : 's'}.
                </p>
              </div>
              <span className="bg-secondary-container text-on-secondary-container flex size-9 items-center justify-center rounded-full">
                <Check className="size-4" />
              </span>
            </div>
            <div className="bg-surface-container-low max-h-48 overflow-y-auto rounded-xl p-3">
              <div className="text-body-medium text-on-surface flex items-center gap-2">
                <FolderKanban className="text-on-surface-variant size-4" />
                {project.name}
              </div>
              <ul className="border-outline-variant mt-2 ml-2 flex flex-col gap-1 border-l pl-4">
                {tasks.map(({ task, milestoneId }) => (
                  <li key={task.id} className="text-body-small text-on-surface">
                    {task.title}
                    {milestoneId ? (
                      <span className="text-on-surface-variant">
                        {' · '}
                        {milestoneName.get(milestoneId)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-title-small text-on-surface">When work appears</legend>
            <label className="border-outline-variant has-[:checked]:border-primary has-[:checked]:bg-primary-container flex cursor-pointer gap-3 rounded-xl border p-3">
              <input
                type="radio"
                name="creation-mode"
                value="all_at_once"
                checked={creationMode === 'all_at_once'}
                onChange={() => {
                  setCreationMode('all_at_once');
                }}
              />
              <span>
                <span className="text-body-medium text-on-surface block">Show the full plan</span>
                <span className="text-body-small text-on-surface-variant block">
                  Create every task at the start. Best for fixed event and season checklists.
                </span>
              </span>
            </label>
            <label className="border-outline-variant has-[:checked]:border-primary has-[:checked]:bg-primary-container flex cursor-pointer gap-3 rounded-xl border p-3">
              <input
                type="radio"
                name="creation-mode"
                value="when_ready"
                checked={creationMode === 'when_ready'}
                onChange={() => {
                  setCreationMode('when_ready');
                }}
              />
              <span>
                <span className="text-body-medium text-on-surface block">
                  Show tasks when ready
                </span>
                <span className="text-body-small text-on-surface-variant block">
                  Start with the first work and release dependent steps as the process advances.
                </span>
              </span>
            </label>
          </fieldset>

          <section
            className="flex items-center justify-between gap-4"
            aria-labelledby="project-repeat-heading"
          >
            <div>
              <h3 id="project-repeat-heading" className="text-title-small text-on-surface">
                Schedule
              </h3>
              <p className="text-body-small text-on-surface-variant">
                Each occurrence gets its own ordinary {projectNoun.toLowerCase()} and tasks.
              </p>
            </div>
            <RepeatTaskControl
              value={repeat}
              onChange={setRepeat}
              today={today}
              timezone={timezone}
              disabled={create.isPending}
            />
          </section>

          {tasks.length === 0 ? (
            <p role="alert" className="text-error text-body-small">
              Add at least one task before making this {projectNoun.toLowerCase()} repeatable.
            </p>
          ) : null}
          {create.isError ? (
            <p role="alert" className="text-error text-body-small">
              We couldn&apos;t start this repeating {projectNoun.toLowerCase()}. Please try again.
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-outline-variant border-t px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              create.mutate(undefined);
            }}
            disabled={tasks.length === 0 || repeat.kind === 'none' || create.isPending}
          >
            <RefreshCw className="size-4" />
            {create.isPending ? 'Starting…' : 'Start repeating'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
