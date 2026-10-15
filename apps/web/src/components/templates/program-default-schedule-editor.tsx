'use client';
import { useState, type JSX } from 'react';
import { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Field, Input, Select, Surface } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { WorkTemplatePicker } from '@/components/composer/work-template-picker';
import { RelativeRepeatFields } from '@/components/recurrence/relative-repeat-fields';
import { TemplateDisclosure } from './template-disclosure';
import { WorkTemplateAssignmentRules } from './work-template-blueprint-relations';
import { defaultScheduleForTemplate } from './program-default-schedule-draft';

/** Focus one reusable Program routine; template choice creates its canonical editable draft. */
export function ProgramDefaultScheduleEditor(props: {
  readonly orgId: string;
  readonly value: ProgramDefaultSchedule | undefined;
  readonly templates: readonly WorkTemplateOut[];
  readonly disabled: boolean;
  readonly onChange: (value: ProgramDefaultSchedule) => void;
  readonly onClose: () => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly canMoveEarlier: boolean;
  readonly canMoveLater: boolean;
}): JSX.Element {
  const { value, disabled, onChange } = props;
  const program = useVocabulary('program');
  const [kind, setKind] = useState<'task' | 'project'>(value?.template.targetType ?? 'project');
  return (
    <Surface
      tone="prominent"
      shape="medium"
      pad="roomy"
      className="flex min-w-0 flex-col gap-5"
      role="group"
      aria-label="Reusable recurring work"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 tabIndex={-1} className="text-title-large break-words outline-none">
          {value?.name.trim() ? value.name : 'Add recurring work'}
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
          Back to outline
        </Button>
      </div>
      <RoutineTemplateChoice {...props} kind={kind} onKind={setKind} />
      {value ? (
        <>
          <RoutineStartingFields value={value} disabled={disabled} onChange={onChange} />
          <section className="flex min-w-0 flex-col gap-3" aria-label="Reusable schedule rhythm">
            <h4 className="text-title-medium">Repeat</h4>
            <RelativeRepeatFields
              value={value.cadence}
              disabled={disabled}
              onChange={(cadence) => {
                onChange({ ...value, cadence });
              }}
            />
          </section>
          <TemplateDisclosure title="Responsibility">
            <WorkTemplateAssignmentRules
              value={value}
              parentLabel={program}
              disabled={disabled}
              onChange={(patch) => {
                onChange({ ...value, ...patch });
              }}
            />
          </TemplateDisclosure>
          {!ProgramDefaultSchedule.safeParse(value).success ? (
            <InlineBanner tone="critical" title="Review this routine">
              Name the schedule, use supported title tokens, and keep its interval, relative start
              and run count within their limits.
            </InlineBanner>
          ) : null}
          <RoutineVersionField
            value={value}
            template={props.templates.find((item) => item.id === value.template.workTypeId)}
            disabled={disabled}
            onChange={onChange}
          />
          <RoutineActions {...props} />
        </>
      ) : (
        <p className="text-body-medium text-on-surface-variant">
          Choose a published template for the work this routine will create. Its included work comes
          with it.
        </p>
      )}
    </Surface>
  );
}
function RoutineStartingFields({
  value,
  disabled,
  onChange,
}: {
  readonly value: ProgramDefaultSchedule;
  readonly disabled: boolean;
  readonly onChange: (value: ProgramDefaultSchedule) => void;
}): JSX.Element {
  return (
    <>
      <Field label="Schedule name">
        <Input
          aria-label="Reusable schedule name"
          disabled={disabled}
          maxLength={120}
          value={value.name}
          onChange={(event) => {
            onChange({ ...value, name: event.target.value });
          }}
        />
      </Field>
      <Field
        label="Title of each new item"
        description="Use {month}, {day}, {year} or {quarter} to include its run date."
      >
        <Input
          aria-label="Reusable schedule title pattern"
          disabled={disabled}
          maxLength={256}
          value={value.titlePattern}
          onChange={(event) => {
            onChange({ ...value, titlePattern: event.target.value });
          }}
        />
      </Field>
    </>
  );
}
function RoutineTemplateChoice({
  value,
  kind,
  onKind,
  orgId,
  disabled,
  onChange,
}: Parameters<typeof ProgramDefaultScheduleEditor>[0] & {
  readonly kind: 'task' | 'project';
  readonly onKind: (kind: 'task' | 'project') => void;
}): JSX.Element {
  const selection = value?.template.selection;
  const project = useVocabulary('project');
  const task = useVocabulary('task');
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Routine work template">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-32">
          <Select
            aria-label="Reusable schedule work kind"
            value={kind}
            disabled={disabled}
            onChange={(event) => {
              onKind(event.target.value as 'task' | 'project');
            }}
          >
            <option value="project">{project}</option>
            <option value="task">{task}</option>
          </Select>
        </div>
        <WorkTemplatePicker
          orgId={orgId}
          teamId={null}
          kind={kind}
          selectedId={kind === value?.template.targetType ? value.template.workTypeId : undefined}
          selectedVersionId={selection?.kind === 'pinned' ? selection.workTypeVersionId : undefined}
          disabled={disabled}
          onSelect={(next) => {
            const draft = defaultScheduleForTemplate(next, value);
            if (draft) onChange(draft);
          }}
        />
      </div>
      {value && kind !== value.template.targetType ? (
        <p className="text-body-small text-on-surface-variant">
          Choose a {kind === 'project' ? project.toLocaleLowerCase() : task.toLocaleLowerCase()}{' '}
          template to replace the current work.
        </p>
      ) : null}
    </section>
  );
}
function RoutineVersionField({
  value,
  template,
  disabled,
  onChange,
}: {
  readonly value: ProgramDefaultSchedule;
  readonly template: WorkTemplateOut | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: ProgramDefaultSchedule) => void;
}): JSX.Element {
  const program = useVocabulary('program');
  const selection = value.template.selection;
  return (
    <TemplateDisclosure title="Template version">
      <Field label="Template updates">
        <Select
          aria-label="Reusable schedule template updates"
          value={selection.kind}
          disabled={disabled}
          onChange={(event) => {
            const next =
              event.target.value === 'pinned' && template?.latestVersion
                ? { kind: 'pinned' as const, workTypeVersionId: template.latestVersion.id }
                : { kind: 'latest' as const };
            onChange({ ...value, template: { ...value.template, selection: next } });
          }}
        >
          <option value="latest">Use the latest published version</option>
          <option value="pinned" disabled={!template?.latestVersion && selection.kind !== 'pinned'}>
            Keep this version
          </option>
        </Select>
      </Field>
      <p className="text-body-small text-on-surface-variant">
        {selection.kind === 'pinned'
          ? `Keep the selected publication${template?.latestVersion?.id === selection.workTypeVersionId ? ` · Version ${template.latestVersion.number}` : ''}.`
          : `Each new run uses the latest publication available to its ${program}.`}
      </p>
    </TemplateDisclosure>
  );
}
function RoutineActions({
  disabled,
  onMove,
  onRemove,
  canMoveEarlier,
  canMoveLater,
}: Parameters<typeof ProgramDefaultScheduleEditor>[0]): JSX.Element {
  const program = useVocabulary('program');
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Routine ordering">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={disabled || !canMoveEarlier}
          onClick={() => {
            onMove(-1);
          }}
        >
          Move earlier
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled || !canMoveLater}
          onClick={() => {
            onMove(1);
          }}
        >
          Move later
        </Button>
        <Button type="button" variant="ghost" disabled={disabled} onClick={onRemove}>
          Remove routine
        </Button>
      </div>
      <p className="text-body-small text-on-surface-variant">
        Removing this routine affects future {program} creations. Existing {program} copies keep
        their schedules.
      </p>
    </section>
  );
}
