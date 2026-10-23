'use client';

import {
  LazyTabPanels,
  TabsScope,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  fieldSurface,
} from '@docket/ui/primitives';
import type {
  TemplateDraft,
  TemplateOut,
  TemplateTargetType,
} from '@docket/work/template-contract';
import { InlineBanner } from '@docket/ui/components';

import { type JSX, useState } from 'react';

import type { ComposerShellProps } from '@/components/composer/composer-shell';
import { ComposerClosePrompt } from '@/components/composer/composer-close-prompt';
import {
  ComposerIdentityHeader,
  PropertyStrip,
} from '@/components/composer/composer-shell-regions';
import { useDiscardPrompt } from '@/components/composer/use-discard-prompt';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { TemplateReview } from './template-review';
import { useStatusRegistry } from '@/components/statuses/status-registry';

/** The composer fields and template metadata shared by all four work kinds. */
export interface TemplateWorkflowProps extends ComposerShellProps {
  readonly workNoun: string;
  readonly templateName: string;
  readonly templateDescription: string;
  readonly templateScope: TemplateOut['scope'];
  readonly targetType: TemplateTargetType;
  readonly editing: boolean;
  readonly metadataDirty: boolean;
  readonly payload: TemplateDraft;
  readonly originalPayload?: TemplateDraft | undefined;
  readonly templateTeamId?: string | null;
}

const STEPS = [
  { value: 'basics', label: 'Basics' },
  { value: 'work', label: 'Work' },
  { value: 'review', label: 'Review' },
];

/** Render the template workflow with one scrolling body and the ordinary composer fields. */
export function TemplateWorkflowShell(props: TemplateWorkflowProps): JSX.Element {
  return (
    <TabsScope>
      <TemplateWorkflowContent {...props} />
    </TabsScope>
  );
}

function TemplateWorkflowContent(props: TemplateWorkflowProps): JSX.Element {
  const [step, setStep] = useState(props.editing ? 'work' : 'basics');
  const baseline = useTemplateBaseline(props);
  const prompt = useDiscardPrompt({
    creating: props.creating,
    contentDisabled: false,
    canSubmit: props.canSubmit,
    isDirty: props.metadataDirty || payloadKey(props.payload) !== payloadKey(baseline),
    onOpenChange: props.onOpenChange,
  });
  const disabled = prompt.editDisabled;
  const selectStep = (value: string): void => {
    if (!disabled) setStep(value);
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) prompt.requestClose();
      }}
    >
      <DialogContent
        ref={prompt.focusRegionRef}
        presentation={{ kind: 'responsive-fullscreen', size: 'wide', height: 'content' }}
        aria-describedby={undefined}
        aria-busy={props.creating}
        onEscapeKeyDown={prompt.onEscapeKeyDown}
      >
        <DialogHeader
          inset="responsive"
          className="gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <TemplateHeading props={props} />
          <div className="min-w-0 flex-1 self-stretch sm:self-center">
            <Tabs
              label="Template steps"
              value={step}
              onValueChange={selectStep}
              items={STEPS.map((item) => ({
                ...item,
                disabled: disabled || (item.value !== 'basics' && !props.canSubmit),
              }))}
            />
          </div>
        </DialogHeader>
        <DialogBody
          inset="responsive"
          className="@container flex-auto"
          onFocusCapture={prompt.onDraftFocusCapture}
        >
          <LazyTabPanels
            values={STEPS.map((item) => item.value)}
            as="fieldset"
            value={step}
            disabled={disabled}
            className="flex min-w-0 flex-col gap-6"
          >
            {step === 'basics' ? (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">{props.leadingFields}</div>
            ) : null}
            {step === 'work' ? <TemplateWorkFields props={props} disabled={disabled} /> : null}
            {step === 'review' ? <TemplateReview props={props} /> : null}
          </LazyTabPanels>
        </DialogBody>
        <DialogFooter inset="responsive" className="flex-col gap-3 sm:flex-col sm:items-stretch">
          {props.error ? (
            <InlineBanner tone="critical" density="compact" title="Could not save the template">
              {props.error}
            </InlineBanner>
          ) : null}
          {prompt.confirming ? (
            <ComposerClosePrompt onKeepEditing={prompt.keepEditing} onDiscard={prompt.discard} />
          ) : (
            <TemplateActions props={props} step={step} onStepChange={selectStep} />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateActions({
  props,
  step,
  onStepChange,
}: {
  props: TemplateWorkflowProps;
  step: string;
  onStepChange: (step: string) => void;
}): JSX.Element {
  const save = props.editing || step === 'review';
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {step !== 'basics' ? (
        <Button
          type="button"
          variant="ghost"
          disabled={props.creating}
          onClick={() => {
            onStepChange(step === 'review' ? 'work' : 'basics');
          }}
        >
          Back
        </Button>
      ) : null}
      <Button
        type="button"
        className="ml-auto"
        disabled={props.creating || !props.canSubmit}
        aria-busy={props.creating}
        onClick={() => {
          if (save) props.onSubmit();
          else onStepChange(step === 'basics' ? 'work' : 'review');
        }}
      >
        {props.creating ? 'Saving…' : save ? props.submitLabel : 'Continue'}
      </Button>
    </div>
  );
}

function TemplateWorkFields({
  props,
  disabled,
}: {
  props: TemplateWorkflowProps;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-3">
        <ComposerIdentityHeader
          embedded
          fieldPresentation="form"
          legacyContextVisible={false}
          editDisabled={disabled}
          title={props.title}
          onTitleChange={props.onTitleChange}
          titlePlaceholder={props.titlePlaceholder}
          summary={props.summary}
          onSummaryChange={props.onSummaryChange}
          summaryPlaceholder={props.summaryPlaceholder}
          summaryMaxLength={props.summaryMaxLength}
          hasSectionSwitcher={false}
          activeSectionValue="description"
          onSectionValueChange={(value) => {
            void value;
          }}
          supplementalSections={[]}
          sectionValue={(id) => id}
        />
        <PropertyStrip ariaLabel="Settings">{props.children}</PropertyStrip>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 className="text-label-large">Description</h2>
        <FreeformTextEditor
          value={props.body}
          onChange={props.onBodyChange}
          disabled={disabled}
          placeholder={props.bodyPlaceholder ?? 'Description…'}
          ariaLabel="Work description"
          mentionOrgId={props.mentionOrgId}
          className={`${fieldSurface({ controlSize: 'md', multiline: true, ringOn: 'within' })} min-h-40 max-w-none flex-none sm:min-h-48`}
        />
      </div>
    </div>
  );
}

function payloadKey(payload: TemplateDraft): string {
  return JSON.stringify(
    Object.entries(payload)
      // The editor appends an empty final paragraph after a list without changing authored text.
      .map(([key, value]): readonly [string, unknown] => [key, comparableValue(key, value)])
      .filter(
        ([, value]) =>
          value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function comparableValue(key: string, value: unknown): unknown {
  if (Array.isArray(value)) return (value as unknown[]).slice().sort();
  return key === 'description' && typeof value === 'string'
    ? value.replace(/(?:\r?\n)+$/, '')
    : value;
}

function initialPayload(
  kind: TemplateTargetType,
  stored: TemplateDraft | undefined,
  status: string | undefined,
): TemplateDraft {
  const defaults = {
    task: { targetType: 'task', priority: 'none' },
    project: { targetType: 'project', ...(status ? { status } : {}) },
    initiative: {
      targetType: 'initiative',
      ...(status ? { status } : {}),
      priority: 'none',
      updateCadence: 'monthly',
    },
    program: { targetType: 'program', ...(status ? { status } : {}), visibility: 'public' },
  } satisfies Record<TemplateTargetType, TemplateDraft>;
  if (!stored) return defaults[kind];
  switch (stored.targetType) {
    case 'task':
      return { ...defaults.task, ...stored };
    case 'project':
      return { ...defaults.project, ...stored };
    case 'initiative':
      return { ...defaults.initiative, ...stored };
    case 'program':
      return { ...defaults.program, ...stored };
  }
}

function useTemplateBaseline(props: TemplateWorkflowProps): TemplateDraft {
  const registry = useStatusRegistry();
  return initialPayload(
    props.targetType,
    props.originalPayload,
    registry.defaultOf(props.targetType)?.key,
  );
}

function TemplateHeading({ props }: { props: TemplateWorkflowProps }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <DialogTitle>{props.heading}</DialogTitle>
      {props.editing ? (
        <p className="text-body-medium text-on-surface-variant">{props.workNoun} template</p>
      ) : null}
    </div>
  );
}
