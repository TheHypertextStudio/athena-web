'use client';

/** Focused setup for turning an existing Project into a repeating process. */
import type { MilestoneOut } from '@docket/work/milestone-contract';
import type { ProcessCreationMode } from '../../lib/contracts/recurrence';
import type { ProjectOut } from '../../lib/contracts/project';
import { InlineBanner, todayIso } from '@docket/ui/components';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { withComposerReset } from '@/components/composer/reset-on-open';
import { useDiscardPrompt } from '@/components/composer/use-discard-prompt';
import {
  RepeatProjectCreationMode,
  RepeatProjectFooter,
  RepeatProjectReview,
  RepeatProjectWork,
} from './repeat-project-steps';

import type { MilestoneTask } from '@/components/project-detail/milestone-tasks';
import { isValidProjectRepeat, useRepeatProjectMutation } from './repeat-project-mutation';

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
function RepeatProjectComposer({
  open,
  onOpenChange,
  orgId,
  project,
  milestones,
  tasks,
  projectNoun,
  onCreated,
}: RepeatProjectDialogProps): JSX.Element {
  const { today, timezone, defaultStart } = projectRepeatDefaults(project);
  const [creationMode, setCreationMode] = useState<ProcessCreationMode>('all_at_once');
  const [repeat, setRepeat] = useState<TaskRepeatDraft>(() =>
    createDefaultTaskRepeat('monthly', defaultStart, timezone),
  );
  const [step, setStep] = useState(0);
  const [initialRepeat] = useState(repeat);
  const { create, failure } = useRepeatProjectMutation({
    orgId,
    project,
    projectNoun,
    creationMode,
    repeat,
    effectiveFrom: defaultStart,
    onOpenChange,
    onCreated,
  });

  const prompt = useDiscardPrompt({
    creating: create.isPending,
    contentDisabled: false,
    canSubmit: tasks.length > 0 && isValidProjectRepeat(repeat),
    isDirty:
      creationMode !== 'all_at_once' || JSON.stringify(repeat) !== JSON.stringify(initialRepeat),
    onOpenChange,
  });
  const work = { name: project.name, projectNoun, milestones, tasks };
  const labels = ['Work', 'Repeat', 'Review'] as const;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) prompt.requestClose();
      }}
    >
      <DialogContent
        ref={prompt.focusRegionRef}
        containerQuery
        presentation={{
          kind: 'responsive-fullscreen',
          size: 'wide',
          height: 'tall',
        }}
        onEscapeKeyDown={prompt.onEscapeKeyDown}
      >
        <DialogHeader inset="responsive">
          <DialogTitle>Repeat this {projectNoun.toLowerCase()}</DialogTitle>
          <DialogDescription>{project.name}</DialogDescription>
          <ol
            aria-label="Repeat setup steps"
            className="text-label-large mt-3 flex flex-wrap gap-x-6 gap-y-2"
          >
            {labels.map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? 'step' : undefined}
                className={step === index ? 'text-primary' : 'text-on-surface-variant'}
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>
        </DialogHeader>
        <DialogBody
          inset="responsive"
          onFocusCapture={prompt.onDraftFocusCapture}
          className="flex flex-auto flex-col gap-6"
        >
          <div className="flex w-full flex-col gap-6">
            {step === 0 ? (
              <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
                <RepeatProjectWork {...work} />
                <RepeatProjectCreationMode
                  value={creationMode}
                  onChange={setCreationMode}
                  disabled={prompt.editDisabled}
                />
              </div>
            ) : null}
            {step === 1 ? (
              <section
                className="flex min-w-0 flex-col gap-4"
                aria-labelledby="project-repeat-heading"
              >
                <h3 id="project-repeat-heading" className="text-title-medium">
                  When does it repeat?
                </h3>
                <p className="text-body-medium text-on-surface-variant">
                  Each occurrence has its own {projectNoun.toLowerCase()} and tasks.
                </p>
                <RepeatTaskControl
                  presentation="inline"
                  value={repeat}
                  workNoun={projectNoun}
                  onChange={setRepeat}
                  today={today}
                  timezone={timezone}
                  disabled={prompt.editDisabled}
                />
              </section>
            ) : null}
            {step === 2 ? (
              <RepeatProjectReview
                {...work}
                creationMode={creationMode}
                effectiveFrom={defaultStart}
                repeat={repeat}
                disabled={prompt.editDisabled}
                onEditWork={() => {
                  setStep(0);
                }}
                onEditRepeat={() => {
                  setStep(1);
                }}
              />
            ) : null}
            {step === 1 && repeat.kind !== 'none' && !isValidProjectRepeat(repeat) ? (
              <InlineBanner tone="critical" title="Check the repeat settings">
                Intervals and occurrence counts must be positive whole numbers.
              </InlineBanner>
            ) : null}
            {failure ? (
              <InlineBanner tone="critical" title="Could not finish setup">
                {failure}
              </InlineBanner>
            ) : null}
            {tasks.length === 0 ? (
              <InlineBanner tone="critical" title="Nothing to repeat yet">
                Add at least one task before making this {projectNoun.toLowerCase()} repeatable.
              </InlineBanner>
            ) : null}
          </div>
        </DialogBody>
        <RepeatProjectFooter
          prompt={prompt}
          step={step}
          onStepChange={setStep}
          pending={create.isPending}
          workReady={tasks.length > 0}
          onStart={() => {
            create.mutate(undefined);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function projectRepeatDefaults(project: ProjectOut): {
  readonly today: string;
  readonly timezone: string;
  readonly defaultStart: string;
} {
  const today = todayIso();
  return {
    today,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    defaultStart: project.startDate?.slice(0, 10) ?? today,
  };
}

/** Reset every repeat setting and discard state when a new setup opens. */
export const RepeatProjectDialog = withComposerReset(RepeatProjectComposer);
