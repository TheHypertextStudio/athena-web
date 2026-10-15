'use client';
import { useRef, useState, type JSX } from 'react';
import type {
  WorkScheduleCreate,
  WorkSchedulePreviewOut,
} from '@docket/work/work-schedule-management';
import type { WorkScheduleStepOverride } from '@docket/work/work-schedule-fields';
import type { BlueprintPreviewSummary } from '@docket/work/work-template-blueprint';
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { Button, Field, Surface } from '@docket/ui/primitives';
import { EnumPicker, InlineBanner } from '@docket/ui/components';
import { BlueprintPreviewConsequences } from '@/components/composer/blueprint-preview-consequences';
import { BlueprintReviewBody } from '@/components/composer/blueprint-creation-preview';
import { WorkspaceActorPicker } from '@/components/people/workspace-actor-picker';
import type { ComposerOptions } from '@/components/pickers/use-composer-options';
import type { ScheduleAuthoringDraft } from './schedule-draft';
import { scheduleDateLabel } from './schedule-presentations';
import { scheduleTitleExample, scheduleTriggerSummary } from './schedule-draft';

interface ScheduleReviewProps {
  readonly orgId: string;
  readonly programName: string;
  readonly draft: ScheduleAuthoringDraft;
  readonly input: WorkScheduleCreate;
  readonly options: ComposerOptions;
  readonly disabled: boolean;
  readonly archived: boolean;
  readonly onChange: (draft: ScheduleAuthoringDraft) => void;
  readonly preview: {
    data: WorkSchedulePreviewOut | undefined;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  };
}
/** Review the accepted title, destination and canonical expanded work before saving a schedule. */
export function ScheduleReview({
  programName,
  draft,
  input,
  options,
  archived,
  preview,
}: ScheduleReviewProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h2 tabIndex={-1} className="text-headline-small outline-none">
          Ready for the next run
        </h2>
      </div>
      <ScheduleReviewSummary
        {...{ input, draft, programName, archived }}
        scheduledFor={preview.data?.scheduledFor}
        title={preview.data?.title}
      />
      {archived ? (
        <InlineBanner tone="info" title="This template is archived">
          This schedule keeps its saved included work. Choose a published template in Work to change
          which children are included. Responsibility and future timing remain editable.
        </InlineBanner>
      ) : null}
      <ScheduleSelectedWorkReview input={input} preview={preview} options={options} />
      <p className="text-body-medium text-on-surface-variant">
        Saving affects future runs from {input.effectiveFrom}. Existing work and past runs keep
        their original choices.
      </p>
    </div>
  );
}
function ReviewFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-label-medium text-on-surface-variant">{label}</dt>
      <dd className="text-body-large mt-1 break-words">{value}</dd>
    </div>
  );
}
interface ChildAssignmentProps {
  readonly orgId: string;
  readonly node: BlueprintPreviewSummary;
  readonly input: WorkScheduleCreate;
  readonly options: ComposerOptions;
  readonly disabled: boolean;
  readonly onChange: (overrides: WorkScheduleStepOverride[]) => void;
}
function ChildAssignments({
  orgId,
  node,
  input,
  options,
  disabled,
  onChange,
}: ChildAssignmentProps): JSX.Element | null {
  if (node.kind === 'milestone') return null;
  const saved = input.document.stepOverrides.find(
    (item) => JSON.stringify(item.path) === JSON.stringify(node.path),
  );
  const override: Exclude<WorkScheduleStepOverride, { kind: 'milestone' }> =
    saved && saved.kind !== 'milestone' ? saved : { kind: node.kind, path: node.path };
  const update = (next: WorkScheduleStepOverride): void => {
    onChange([
      ...input.document.stepOverrides.filter(
        (item) => JSON.stringify(item.path) !== JSON.stringify(node.path),
      ),
      next,
    ]);
  };
  return (
    <div className="mt-2">
      <section
        className="flex min-w-0 flex-col gap-4"
        aria-label={`Responsibility for ${node.title}`}
      >
        <h4 tabIndex={-1} className="text-title-medium outline-none">
          {node.title}
        </h4>
        <Field label="Team">
          <EnumPicker
            options={options.teamOptions}
            value={override.teamId ?? null}
            onChange={(id) => {
              update({ ...override, teamId: id ? TeamId.parse(id) : null });
            }}
            ariaLabel={`Team for ${node.title}`}
            placeholder="Use template choice"
            clearLabel="No team"
            disabled={disabled || options.loading}
          />
        </Field>
        <Field label={node.kind === 'task' ? 'Assignee' : 'Lead'}>
          <WorkspaceActorPicker
            orgId={orgId}
            options={node.kind === 'task' ? options.actorOptions : options.memberOptions}
            value={override.responsibleActorId ?? null}
            onChange={(id) => {
              update({ ...override, responsibleActorId: id ? ActorId.parse(id) : null });
            }}
            ariaLabel={`Responsibility for ${node.title}`}
            placeholder="Use template choice"
            clearLabel="Unassigned"
            disabled={disabled || options.loading}
          />
        </Field>
        {saved ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(
                input.document.stepOverrides.filter(
                  (item) => JSON.stringify(item.path) !== JSON.stringify(node.path),
                ),
              );
            }}
            disabled={disabled}
          >
            Use template responsibility
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function ScheduleReviewSummary({
  input,
  draft,
  programName,
  scheduledFor,
  title,
  archived,
}: Pick<Parameters<typeof ScheduleReview>[0], 'input' | 'draft' | 'programName' | 'archived'> & {
  readonly scheduledFor: string | undefined;
  readonly title: string | undefined;
}): JSX.Element {
  return (
    <Surface tone="well" shape="medium" className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <p className="text-label-large text-on-surface-variant">
        Next work on {scheduleDateLabel(scheduledFor ?? input.effectiveFrom)}
      </p>
      <p className="text-headline-medium break-words">{title ?? scheduleTitleExample(draft)}</p>
      <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
        <ReviewFact label="Repeats" value={scheduleTriggerSummary(input.trigger)} />
        <ReviewFact label="Destination" value={programName} />
        <ReviewFact label="Timezone" value={input.document.timezone} />
        <ReviewFact
          label="Template updates"
          value={
            archived
              ? 'Exact saved archived version'
              : input.document.template.selection.kind === 'latest'
                ? 'Latest published version'
                : 'Keep the selected version'
          }
        />
      </dl>
    </Surface>
  );
}

/** Review optional children in Work and edit one child's responsibility in its immediate context. */
export function ScheduleIncludedWork(props: Omit<ScheduleReviewProps, 'programName'>): JSX.Element {
  const { draft, input, disabled, archived, onChange, preview } = props;
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const selected = preview.data?.descendants.find(
    (node) => JSON.stringify(node.path) === selectedPath && node.selected,
  );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="min-w-0" aria-label="Included work">
        <div className={selected ? 'hidden' : 'flex min-w-0 flex-col gap-4'}>
          <h3 className="text-title-large">Included work</h3>
          {preview.data ? (
            <div>
              <h4 className="text-title-medium break-words">{preview.data.title}</h4>
              <p className="text-body-small text-on-surface-variant">
                Scheduled {input.document.root.kind} · Parent work
              </p>
            </div>
          ) : null}
          <IncludedWorkStatus preview={preview} />
          {preview.data ? (
            <BlueprintReviewBody
              rootContextLabel="including the scheduled parent"
              showSelectionSummary={false}
              assignmentLocation="Work"
              preview={preview.data}
              options={{ optionalChoices: input.document.optionalChoices }}
              pending={disabled || preview.isFetching || archived}
              onPage={() => undefined}
              onChange={(value) => {
                onChange({
                  ...draft,
                  document: { ...input.document, optionalChoices: value.optionalChoices },
                });
              }}
              renderChildDetails={(node) =>
                node.selected && node.kind !== 'milestone' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    ref={(button) => {
                      if (button) rowRefs.current.set(JSON.stringify(node.path), button);
                    }}
                    aria-pressed={selectedPath === JSON.stringify(node.path)}
                    aria-label={`Responsibility for ${node.title}`}
                    onClick={() => {
                      setSelectedPath(JSON.stringify(node.path));
                      requestAnimationFrame(() => {
                        const editor = document.getElementById('schedule-child-responsibility');
                        editor?.scrollIntoView({ block: 'nearest' });
                        editor?.querySelector<HTMLElement>('h4')?.focus({ preventScroll: true });
                      });
                    }}
                  >
                    Responsibility
                  </Button>
                ) : null
              }
            />
          ) : null}
        </div>
      </section>
      <ScheduleChildEditor
        selected={selected}
        props={props}
        onClose={() => {
          setSelectedPath(null);
          if (selected)
            requestAnimationFrame(() => {
              const button = rowRefs.current.get(JSON.stringify(selected.path));
              button?.scrollIntoView({ block: 'nearest' });
              button?.focus({ preventScroll: true });
            });
        }}
      />
    </div>
  );
}
function IncludedWorkStatus({
  preview,
}: {
  readonly preview: ScheduleReviewProps['preview'];
}): JSX.Element | null {
  if (preview.isPending)
    return (
      <p role="status" className="text-on-surface-variant">
        Reviewing included work and dates…
      </p>
    );
  if (!preview.isError) return null;
  return (
    <InlineBanner tone="critical" title="Could not review included work">
      Your choices are kept. Try again before starting this schedule.
      <Button variant="ghost" onClick={() => void preview.refetch()}>
        Try again
      </Button>
    </InlineBanner>
  );
}
function ScheduleSelectedWorkReview({
  input,
  preview,
  options,
}: {
  readonly input: WorkScheduleCreate;
  readonly preview: ScheduleReviewProps['preview'];
  readonly options: ComposerOptions;
}): JSX.Element {
  if (preview.isError)
    return (
      <InlineBanner tone="critical" title="Could not review included work">
        <Button variant="ghost" onClick={() => void preview.refetch()}>
          Try again
        </Button>
      </InlineBanner>
    );
  if (!preview.data) return <p role="status">Reviewing included work and dates…</p>;
  const selected = preview.data.descendants.filter((node) => node.selected);
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Selected scheduled work">
      <h3 className="text-title-large">Included work</h3>
      <p className="text-body-medium text-on-surface-variant">
        {selected.length + 1} work items in each run, including the parent.
      </p>
      <BlueprintPreviewConsequences warnings={preview.data.warnings} assignmentLocation="Work" />
      <ol className="flex min-w-0 flex-col gap-3">
        {selected.map((node) => (
          <li key={JSON.stringify(node.path)} className="min-w-0">
            <p className="text-label-large break-words">
              {node.path.length > 1 ? '↳ ' : ''}
              {node.title}
            </p>
            <p className="text-body-small text-on-surface-variant">
              {node.kind} · {reviewResponsibility(input, node, options)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
function reviewResponsibility(
  input: WorkScheduleCreate,
  node: BlueprintPreviewSummary,
  options: ComposerOptions,
): string {
  const override = input.document.stepOverrides.find(
    (value) => JSON.stringify(value.path) === JSON.stringify(node.path),
  );
  if (!override || override.kind === 'milestone' || override.responsibleActorId === undefined)
    return 'Template responsibility';
  if (override.responsibleActorId === null) return 'Unassigned';
  return (
    options.actorOptions.find((value) => value.value === override.responsibleActorId)?.label ??
    'Saved responsibility'
  );
}

function ScheduleChildEditor({
  selected,
  props,
  onClose,
}: {
  readonly selected: BlueprintPreviewSummary | undefined;
  readonly props: Omit<ScheduleReviewProps, 'programName'>;
  readonly onClose: () => void;
}): JSX.Element {
  const { orgId, input, options, disabled, preview, onChange, draft } = props;
  return (
    <>
      {selected ? (
        <Surface id="schedule-child-responsibility" tone="well" shape="medium" pad="roomy">
          <ChildAssignments
            orgId={orgId}
            node={selected}
            input={input}
            options={options}
            disabled={disabled || preview.isFetching}
            onChange={(stepOverrides) => {
              onChange({ ...draft, document: { ...input.document, stepOverrides } });
            }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Back to included work
          </Button>
        </Surface>
      ) : null}
    </>
  );
}
