/** Work and review regions for an existing project's repeat setup. */
import type { MilestoneOut } from '@docket/work/milestone-contract';
import type { JSX } from 'react';
import { FolderKanban, RefreshCw } from '@docket/ui/icons';
import { Button, DialogFooter, Surface } from '@docket/ui/primitives';

import { ComposerClosePrompt } from '@/components/composer/composer-close-prompt';
import type { DiscardPrompt } from '@/components/composer/use-discard-prompt';
import type { MilestoneTask } from '@/components/project-detail/milestone-tasks';
import type { ProcessCreationMode } from '@/lib/contracts/recurrence';
import { taskRepeatSummary, type TaskRepeatDraft } from './repeat-task-control';
import { formatDate } from './series-management-values';

/** The concrete work copied into each occurrence. */
export interface RepeatProjectWorkProps {
  readonly name: string;
  readonly projectNoun: string;
  readonly milestones: readonly MilestoneOut[];
  readonly tasks: readonly MilestoneTask[];
}

/** Show real milestones and tasks, including milestones that contain no tasks. */
export function RepeatProjectWork({
  name,
  projectNoun,
  milestones,
  tasks,
}: RepeatProjectWorkProps): JSX.Element {
  const ungrouped = tasks.filter(
    ({ milestoneId }) => !milestones.some(({ id }) => id === milestoneId),
  );
  return (
    <section className="flex flex-col gap-3" aria-labelledby="included-work-heading">
      <h3 id="included-work-heading" className="text-title-small text-on-surface">
        Work included
      </h3>
      <p className="text-body-small text-on-surface-variant">
        One {projectNoun.toLowerCase()}, {milestones.length} milestone
        {milestones.length === 1 ? '' : 's'}, and {tasks.length} task{tasks.length === 1 ? '' : 's'}
        .
      </p>
      <Surface tone="card" shape="medium" pad="roomy" className="flex flex-col gap-4">
        <h4 className="text-title-medium flex items-center gap-2">
          <FolderKanban aria-hidden className="size-5 shrink-0" />
          {name}
        </h4>
        {milestones.map((milestone) => (
          <section key={milestone.id} className="flex flex-col gap-2">
            <h5 className="text-label-large">{milestone.name}</h5>
            <WorkTasks tasks={tasks.filter(({ milestoneId }) => milestoneId === milestone.id)} />
          </section>
        ))}
        {ungrouped.length > 0 ? <WorkTasks tasks={ungrouped} /> : null}
      </Surface>
    </section>
  );
}

function WorkTasks({ tasks }: { readonly tasks: readonly MilestoneTask[] }): JSX.Element {
  return tasks.length === 0 ? (
    <p className="text-body-small text-on-surface-variant">No tasks.</p>
  ) : (
    <ul className="text-body-medium flex flex-col gap-2 pl-3">
      {tasks.map(({ task }) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  );
}

/** Props for the task release choice. */
export interface RepeatProjectCreationModeProps {
  readonly value: ProcessCreationMode;
  readonly onChange: (value: ProcessCreationMode) => void;
  readonly disabled: boolean;
}

/** Choose whether every task appears immediately or dependencies release it. */
export function RepeatProjectCreationMode({
  value,
  onChange,
  disabled,
}: RepeatProjectCreationModeProps): JSX.Element {
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <legend className="text-title-small text-on-surface mb-3">When work appears</legend>
      {(
        [
          [
            'all_at_once',
            'Show the full plan',
            'Create every task at the start of each occurrence.',
          ],
          [
            'when_ready',
            'Show tasks when ready',
            'Release dependent tasks as earlier steps finish.',
          ],
        ] as const
      ).map(([mode, label, description]) => (
        <Surface
          key={mode}
          as="label"
          tone={value === mode ? 'prominent' : 'card'}
          shape="medium"
          pad="roomy"
          className="flex cursor-pointer items-start gap-3"
        >
          <input
            type="radio"
            name="creation-mode"
            value={mode}
            checked={value === mode}
            onChange={() => {
              onChange(mode);
            }}
            className="mt-1"
          />
          <span>
            <span className="text-body-medium block">{label}</span>
            <span className="text-body-small text-on-surface-variant block">{description}</span>
          </span>
        </Surface>
      ))}
    </fieldset>
  );
}

/** Props for reviewing the saved recurrence settings. */
export interface RepeatProjectReviewProps extends RepeatProjectWorkProps {
  readonly creationMode: ProcessCreationMode;
  readonly effectiveFrom: string;
  readonly repeat: TaskRepeatDraft;
  readonly disabled: boolean;
  readonly onEditWork: () => void;
  readonly onEditRepeat: () => void;
}

/** Review the concrete work and all authored schedule settings without forecasting dates. */
export function RepeatProjectReview({
  creationMode,
  effectiveFrom,
  repeat,
  disabled,
  onEditWork,
  onEditRepeat,
  ...work
}: RepeatProjectReviewProps): JSX.Element {
  return (
    <div className="grid min-w-0 items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <RepeatProjectWork {...work} />
        <Button variant="ghost" onClick={onEditWork} disabled={disabled} className="self-start">
          Edit work settings
        </Button>
      </div>
      <Surface tone="card" shape="medium" pad="roomy" className="flex min-w-0 flex-col gap-4">
        <h3 className="text-title-small">Repeat settings</h3>
        <dl className="text-body-medium grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-3">
          <dt className="text-on-surface-variant">Work appears</dt>
          <dd>{creationMode === 'all_at_once' ? 'Show the full plan' : 'Show tasks when ready'}</dd>
          <dt className="text-on-surface-variant">Repeats</dt>
          <dd>{taskRepeatSummary(repeat)}</dd>
          {repeat.kind === 'calendar' ? <CalendarReview repeat={repeat} /> : null}
          {repeat.kind === 'after_completion' ? (
            <>
              <dt className="text-on-surface-variant">Starts</dt>
              <dd>{formatDate(effectiveFrom)}</dd>
            </>
          ) : null}
        </dl>
        <Button variant="ghost" onClick={onEditRepeat} disabled={disabled} className="self-start">
          Edit repeat settings
        </Button>
      </Surface>
    </div>
  );
}

function CalendarReview({
  repeat,
}: {
  readonly repeat: Extract<TaskRepeatDraft, { kind: 'calendar' }>;
}): JSX.Element {
  const { schedule, materialization, missedPolicy } = repeat;
  const ends =
    schedule.end.kind === 'never'
      ? 'Never'
      : schedule.end.kind === 'on_date'
        ? formatDate(schedule.end.date)
        : `After ${schedule.end.count} occurrences`;
  const missed = { skip: 'Mark it skipped', carry: 'Keep it overdue', resolve: 'Ask what to do' };
  return (
    <>
      <dt className="text-on-surface-variant">Starts</dt>
      <dd>{formatDate(schedule.startDate)}</dd>
      <dt className="text-on-surface-variant">Timezone</dt>
      <dd className="break-words">{schedule.timezone}</dd>
      <dt className="text-on-surface-variant">Ends</dt>
      <dd>{ends}</dd>
      <dt className="text-on-surface-variant">Missed occurrences</dt>
      <dd>{missed[missedPolicy]}</dd>
      <dt className="text-on-surface-variant">Schedule ahead</dt>
      <dd>
        {materialization.horizonDays} days, at least {materialization.minimumOccurrences}{' '}
        occurrences
      </dd>
    </>
  );
}

/** The shared close guard and step actions for repeat setup. */
export interface RepeatProjectFooterProps {
  readonly prompt: DiscardPrompt;
  readonly step: number;
  readonly onStepChange: (step: number) => void;
  readonly pending: boolean;
  readonly workReady: boolean;
  readonly onStart: () => void;
}

/** Keep navigation and the final save action outside the scrolling body. */
export function RepeatProjectFooter({
  prompt,
  step,
  onStepChange,
  pending,
  workReady,
  onStart,
}: RepeatProjectFooterProps): JSX.Element {
  return (
    <DialogFooter inset="responsive">
      {prompt.confirming ? (
        <ComposerClosePrompt onKeepEditing={prompt.keepEditing} onDiscard={prompt.discard} />
      ) : (
        <>
          <Button variant="ghost" onClick={prompt.requestClose} disabled={pending}>
            Cancel
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {step > 0 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  onStepChange(step - 1);
                }}
                disabled={pending}
              >
                Back
              </Button>
            ) : null}
            {step < 2 ? (
              <Button
                onClick={() => {
                  onStepChange(step + 1);
                }}
                disabled={step === 0 ? pending || !workReady : !prompt.submittable}
              >
                Continue
              </Button>
            ) : (
              <Button onClick={onStart} disabled={!prompt.submittable} aria-busy={pending}>
                <RefreshCw aria-hidden className="size-4" />
                {pending ? 'Starting…' : 'Start repeating'}
              </Button>
            )}
          </div>
        </>
      )}
    </DialogFooter>
  );
}
