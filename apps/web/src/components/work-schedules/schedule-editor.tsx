'use client';
import type { JSX } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Surface,
  Tabs,
} from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { ComposerClosePrompt } from '@/components/composer/composer-close-prompt';
import { scheduleTitleExample, selectScheduleTemplate } from './schedule-draft';
import { ScheduleWorkFields, ScheduleWorkStartingFields } from './schedule-work-fields';
import { ScheduleRepeatFields } from './schedule-repeat-fields';
import { ScheduleReview, ScheduleIncludedWork } from './schedule-review';
import { useScheduleEditor, type ScheduleEditorProps } from './use-schedule-editor';

const SECTIONS = [
  { value: 'schedule-work', label: 'Work' },
  { value: 'schedule-repeat', label: 'Repeat' },
  { value: 'schedule-review', label: 'Review' },
];
type EditorState = ReturnType<typeof useScheduleEditor>;
/** A focused, re-enterable schedule definition with retained input and an explicit final review. */
export function ScheduleEditor(props: ScheduleEditorProps): JSX.Element {
  const state = useScheduleEditor(props);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(value) => {
        if (!value) state.prompt.requestClose();
      }}
    >
      <DialogContent
        ref={state.prompt.focusRegionRef}
        presentation={{ kind: 'responsive-fullscreen', size: 'wide', height: 'content' }}
        aria-busy={state.saving}
        onEscapeKeyDown={state.prompt.onEscapeKeyDown}
      >
        <DialogHeader inset="responsive" className="gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle>{props.schedule ? 'Edit future runs' : 'Add a schedule'}</DialogTitle>
            <DialogDescription className="break-words">{props.programName}</DialogDescription>
          </div>
          <Tabs
            label="Schedule definition sections"
            value={state.section}
            onValueChange={(next) => {
              state.selectSection(next);
            }}
            items={SECTIONS.map((item) => ({ ...item, disabled: state.prompt.editDisabled }))}
          />
        </DialogHeader>
        <DialogBody
          inset="responsive"
          className="@container"
          onFocusCapture={state.prompt.onDraftFocusCapture}
        >
          <Surface tone="card" shape="large" className="p-4 sm:p-6">
            <ScheduleEditorPanels props={props} state={state} />
          </Surface>
        </DialogBody>
        <ScheduleEditorFooter state={state} editing={Boolean(props.schedule)} />
      </DialogContent>
    </Dialog>
  );
}
interface EditorPanelsProps {
  readonly props: ScheduleEditorProps;
  readonly state: EditorState;
}
function ScheduleEditorPanels({ props, state }: EditorPanelsProps): JSX.Element {
  const {
    draft,
    setDraft,
    section,
    options,
    prompt,
    selected,
    today,
    input,
    preview,
    selectSection,
  } = state;
  return (
    <fieldset disabled={prompt.editDisabled} className="min-w-0">
      <div
        role="tabpanel"
        id="tabpanel-schedule-work"
        aria-labelledby="tab-schedule-work"
        hidden={section !== 'schedule-work'}
      >
        <EditorWorkSection props={props} state={state} />
      </div>
      <div
        role="tabpanel"
        id="tabpanel-schedule-repeat"
        aria-labelledby="tab-schedule-repeat"
        hidden={section !== 'schedule-repeat'}
      >
        <ScheduleRepeatFields
          draft={draft}
          today={today}
          minimumDate={state.minimumDate}
          disabled={prompt.editDisabled}
          onChange={setDraft}
          editing={Boolean(props.schedule)}
        />
      </div>
      <div
        role="tabpanel"
        id="tabpanel-schedule-review"
        aria-labelledby="tab-schedule-review"
        hidden={section !== 'schedule-review'}
      >
        {input ? (
          <ScheduleReview
            orgId={props.orgId}
            programName={props.programName}
            draft={draft}
            input={input}
            options={options}
            disabled={prompt.editDisabled}
            archived={Boolean(state.retainedTemplate) || selected?.status === 'archived'}
            onChange={setDraft}
            preview={preview}
          />
        ) : (
          <IncompleteScheduleReview
            onWork={() => {
              selectSection('schedule-work', true);
            }}
          />
        )}
      </div>
    </fieldset>
  );
}
function ScheduleEditorFooter({
  state,
  editing,
}: {
  readonly state: EditorState;
  readonly editing: boolean;
}): JSX.Element {
  const { options, failure, prompt } = state;
  return (
    <DialogFooter inset="responsive" className="flex-col gap-3 sm:flex-col sm:items-stretch">
      {options.error ? (
        <InlineBanner tone="warning" title="Some responsibility choices are unavailable">
          <Button variant="ghost" onClick={options.retry}>
            Reload choices
          </Button>
        </InlineBanner>
      ) : null}
      {failure ? (
        <InlineBanner tone="critical" title="Schedule was not saved">
          {failure}
        </InlineBanner>
      ) : null}
      {prompt.confirming ? (
        <ComposerClosePrompt onKeepEditing={prompt.keepEditing} onDiscard={prompt.discard} />
      ) : (
        <ScheduleEditorActions state={state} editing={editing} />
      )}
    </DialogFooter>
  );
}
function ScheduleEditorActions({
  state,
  editing,
}: {
  readonly state: EditorState;
  readonly editing: boolean;
}): JSX.Element {
  const { saving, section, ready, prompt, draft, selectSection, submit } = state;
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button variant="ghost" disabled={saving} onClick={prompt.requestClose}>
        Cancel
      </Button>
      <span className="text-body-small text-on-surface-variant hidden min-w-0 flex-1 truncate sm:block">
        {state.preview.isPlaceholderData
          ? scheduleTitleExample(draft)
          : (state.preview.data?.title ??
            scheduleTitleExample(draft) ??
            'Define the work, then choose its rhythm')}
      </span>
      <Button
        className="ml-auto"
        disabled={saving || (section === 'schedule-review' && !ready)}
        onClick={() => {
          if (section === 'schedule-review') void submit();
          else
            selectSection(
              section === 'schedule-work' ? 'schedule-repeat' : 'schedule-review',
              true,
            );
        }}
      >
        {editorActionLabel(saving, section, editing)}
      </Button>
    </div>
  );
}
function editorActionLabel(saving: boolean, section: string, editing: boolean): string {
  if (saving) return 'Saving…';
  if (section === 'schedule-review') return editing ? 'Save future runs' : 'Start schedule';
  return section === 'schedule-work' ? 'Choose repeat' : 'Review schedule';
}

function IncompleteScheduleReview({ onWork }: { readonly onWork: () => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <h2 tabIndex={-1} className="text-headline-small outline-none">
        A few choices need attention
      </h2>
      <p className="text-body-large text-on-surface-variant">
        Choose a published template, name the schedule and check its title, dates and timezone
        before review.
      </p>
      <Button variant="secondary" onClick={onWork}>
        Return to work
      </Button>
    </div>
  );
}

function EditorWorkSection({ props, state }: EditorPanelsProps): JSX.Element {
  const { draft, setDraft, options, selected, prompt, input, preview } = state;
  return (
    <div className="grid min-w-0 items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {' '}
      <ScheduleWorkFields
        orgId={props.orgId}
        draft={draft}
        onChange={setDraft}
        onTemplate={(template) => {
          setDraft((current) => selectScheduleTemplate(current, template, props.programId));
        }}
        options={options}
        template={selected}
        retainedTemplate={state.retainedTemplate}
        disabled={prompt.editDisabled}
      />
      {input ? (
        <div className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1">
          <ScheduleIncludedWork
            orgId={props.orgId}
            draft={draft}
            input={input}
            options={options}
            disabled={prompt.editDisabled}
            archived={Boolean(state.retainedTemplate) || selected?.status === 'archived'}
            onChange={setDraft}
            preview={preview}
          />
        </div>
      ) : null}
      <div className="min-w-0 md:col-start-1">
        <ScheduleWorkStartingFields
          orgId={props.orgId}
          draft={draft}
          onChange={setDraft}
          options={options}
          disabled={prompt.editDisabled}
          exampleTitle={preview.isPlaceholderData ? undefined : preview.data?.title}
        />
      </div>
    </div>
  );
}
