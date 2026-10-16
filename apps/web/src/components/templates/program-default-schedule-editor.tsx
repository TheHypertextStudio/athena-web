'use client';
import { useState, type ComponentProps, type JSX } from 'react';
import { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft } from '@docket/ui/icons';
import { Badge, Button, Field, Input, Select } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { WorkTemplatePicker } from '@/components/composer/work-template-picker';
import { RelativeRepeatFields } from '@/components/recurrence/relative-repeat-fields';
import { TemplateDisclosure } from './template-disclosure';
import { WorkTemplateAssignmentRules } from './work-template-blueprint-relations';
import Link from '@/components/docket-link';
import { pendingTemplateReference } from './work-template-pending-reference';
import { workTemplateHref } from './work-template-navigation';
import { defaultScheduleForTemplate } from './program-default-schedule-draft';

/** Focus one reusable Program routine; template choice creates its canonical editable draft. */
export function ProgramDefaultScheduleEditor(props: {
  readonly orgId: string;
  readonly parentTemplateId?: string | undefined;
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
  const { value } = props;
  const [kind, setKind] = useState<'task' | 'project'>(value?.template.targetType ?? 'project');
  return (
    <section className="flex min-w-0 flex-col gap-6" role="group" aria-label="Repeating work">
      <div className="flex min-w-0 flex-col items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-0 sm:px-3"
          onClick={props.onClose}
        >
          <ChevronLeft aria-hidden className="size-4" />
          Back to included work
        </Button>
        <h3 tabIndex={-1} className="text-title-large break-words outline-none">
          {value?.name.trim() ? value.name : 'Add repeating work'}
        </h3>
      </div>
      <RoutineTemplateChoice {...props} kind={kind} onKind={setKind} />
      {value ? (
        <>
          <RoutineWorkFields {...props} value={value} />
        </>
      ) : (
        <p className="text-body-medium text-on-surface-variant">
          Choose a template for the work to repeat. Its included work comes with it.
        </p>
      )}
    </section>
  );
}
function RoutineWorkFields(
  props: Parameters<typeof ProgramDefaultScheduleEditor>[0] & {
    readonly value: ProgramDefaultSchedule;
  },
): JSX.Element {
  const { value, disabled, onChange } = props;
  const program = useVocabulary('program');
  return (
    <>
      <RoutineStartingFields value={value} disabled={disabled} onChange={onChange} />
      <section className="flex min-w-0 flex-col gap-3" aria-label="Repeat settings">
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
        <InlineBanner tone="critical" title="Check repeating work">
          Check the name, title, repeat frequency and number of times before saving.
        </InlineBanner>
      ) : null}
      <RoutineVersionField
        orgId={props.orgId}
        parentTemplateId={props.parentTemplateId}
        value={value}
        template={routineTemplate(props.orgId, value, props.templates)}
        disabled={disabled}
        onChange={onChange}
      />
      <RoutineActions {...props} />
    </>
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
          aria-label="Repeating work name"
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
        description="Use {month}, {day}, {year} or {quarter} to include the date in each item’s title."
      >
        <Input
          aria-label="Title for each new item"
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
  templates,
  disabled,
  onChange,
}: Parameters<typeof ProgramDefaultScheduleEditor>[0] & {
  readonly kind: 'task' | 'project';
  readonly onKind: (kind: 'task' | 'project') => void;
}): JSX.Element {
  const project = useVocabulary('project');
  const task = useVocabulary('task');
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Work to repeat">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-32">
          <Select
            aria-label="Work kind for repeating work"
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
          {...routinePickerSelection(orgId, kind, value, templates)}
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
  orgId,
  parentTemplateId,
  value,
  template,
  disabled,
  onChange,
}: {
  readonly orgId: string;
  readonly parentTemplateId?: string | undefined;
  readonly value: ProgramDefaultSchedule;
  readonly template: WorkTemplateOut | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: ProgramDefaultSchedule) => void;
}): JSX.Element {
  const program = useVocabulary('program');
  const selection = value.template.selection;
  const pending = pendingTemplateReference(value.template, template);
  if (pending)
    return (
      <PendingRoutineVersion orgId={orgId} parentTemplateId={parentTemplateId} template={pending} />
    );
  return (
    <TemplateDisclosure title="Template version">
      <Field label="Template updates">
        <Select
          aria-label="Template updates for repeating work"
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
          ? `Keep the selected version${template?.latestVersion?.id === selection.workTypeVersionId ? ` · Version ${template.latestVersion.number}` : ''}.`
          : `Each new item uses the latest version available to its ${program}.`}
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
  const programs = useVocabulary('program', { plural: true });
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Repeating work actions">
      <div className="flex flex-wrap gap-2">
        {canMoveEarlier || canMoveLater ? (
          <>
            <Button
              type="button"
              variant="ghost"
              className="px-0 sm:px-4"
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
              className="px-0 sm:px-4"
              disabled={disabled || !canMoveLater}
              onClick={() => {
                onMove(1);
              }}
            >
              Move later
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="px-0 sm:px-4"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove repeating work
        </Button>
      </div>
      <p className="text-body-small text-on-surface-variant">
        New {programs} won’t include this repeating work. {programs} already created keep their
        schedules.
      </p>
    </section>
  );
}

function routineTemplate(
  orgId: string,
  value: ProgramDefaultSchedule,
  templates: readonly WorkTemplateOut[],
): WorkTemplateOut | undefined {
  return templates.find(
    (item) =>
      item.organizationId === orgId &&
      item.id === value.template.workTypeId &&
      item.targetType === value.template.targetType,
  );
}
function PendingRoutineVersion({
  orgId,
  parentTemplateId,
  template,
}: {
  readonly orgId: string;
  readonly parentTemplateId?: string | undefined;
  readonly template: WorkTemplateOut;
}): JSX.Element {
  const name = (template.draftDefinition ?? template.definition).name;
  return (
    <section
      aria-label="Unpublished template for repeating work"
      className="flex min-w-0 flex-col gap-2"
    >
      <Badge variant="outline" className="self-start">
        Unpublished {name}
      </Badge>
      <p className="text-body-small text-on-surface-variant">
        This repeating work will use the template’s first published version. Publish that template
        before publishing the template that includes it.
      </p>
      {template.canEdit ? (
        <Button asChild variant="ghost" className="min-h-10 self-start">
          <Link
            navigation="activity"
            href={`${workTemplateHref(orgId, `/${template.id}`)}?section=review${parentTemplateId ? `&returnTo=${parentTemplateId}` : ''}`}
          >
            Review {name}
          </Link>
        </Button>
      ) : null}
    </section>
  );
}

function routinePickerSelection(
  orgId: string,
  kind: 'task' | 'project',
  value: ProgramDefaultSchedule | undefined,
  templates: readonly WorkTemplateOut[],
): Pick<
  ComponentProps<typeof WorkTemplatePicker>,
  'selectedId' | 'selectedLabel' | 'selectedVersionId'
> {
  if (kind !== value?.template.targetType) return {};
  const pending = pendingTemplateReference(
    value.template,
    routineTemplate(orgId, value, templates),
  );
  if (pending)
    return {
      selectedId: value.template.workTypeId,
      selectedLabel: `Unpublished ${(pending.draftDefinition ?? pending.definition).name}`,
    };
  return {
    selectedId: value.template.workTypeId,
    selectedVersionId:
      value.template.selection.kind === 'pinned'
        ? value.template.selection.workTypeVersionId
        : undefined,
  };
}
