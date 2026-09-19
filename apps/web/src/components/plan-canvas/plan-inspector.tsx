'use client';

/**
 * `components/plan-canvas/plan-inspector` — the details column for a selected plan node.
 *
 * @remarks
 * A draft node is edited here: its text fields commit on blur or Enter (the title also while
 * typing, after a pause), its properties are pickers that read as fields, and the footer holds
 * one small Confirm. Remove lives in the header's overflow, away from the primary action. A
 * created node is read-only here with a link to its record. Every field is filled and every
 * picker outlined so the column's controls stand off the floating panel they sit on.
 */
import type { PickerOption } from '@docket/ui/components';
import { DatePicker, EnumPicker } from '@docket/ui/components';
import { CheckCircle2, Ellipsis, OpenInNew, Plus, Trash2, X } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { PlanDraftOut, PlanNode, PlanOp, PlanRoster } from '@docket/work/plan-draft-contract';
import { type JSX, useMemo } from 'react';

import { CanvasInspector } from '@/components/canvas/canvas-inspector';
import Link from '@/components/docket-link';
import { HEALTH_LABEL } from '@/components/entity-display/health';
import { templatesOfKindDef } from '@/components/templates/queries';
import { useApiListQuery } from '@/lib/query';

import { FIELD_TRIGGER, PlanAssignmentFields, PlanFieldRow } from './plan-assignment-fields';
import { CommitText } from './plan-commit-text';
import { describeConfirmation } from './plan-confirm';
import { PlanStateChip, PlanStatusGlyph } from './plan-status';

/** Props for {@link PlanInspector}. */
export interface PlanInspectorProps {
  readonly plan: PlanDraftOut;
  /** The selected node's ref. */
  readonly nodeRef: string;
  readonly orgId: string;
  readonly canEdit: boolean;
  readonly committing: boolean;
  /** Focus the title with its text selected: set for a node the person just added. */
  readonly focusTitle?: boolean | undefined;
  /** Human members, for their avatars beside the roster's names. */
  readonly memberOptions: readonly PickerOption[];
  /** The people and teams the plan may assign; the pickers store their ids. */
  readonly roster: PlanRoster;
  /** Existing initiatives a project may also join. */
  readonly initiativeOptions: readonly PickerOption[];
  readonly onApply: (ops: readonly PlanOp[]) => Promise<unknown>;
  /** Add a draft subtask under this task. */
  readonly onAddSubtask: (taskRef: string) => void;
  readonly onConfirm: (refs: readonly string[]) => void;
  readonly onRemove: (ref: string) => void;
  readonly onClose: () => void;
}

const KIND_LABEL: Record<PlanNode['kind'], string> = {
  initiative: 'Initiative',
  program: 'Program',
  project: 'Project',
  task: 'Task',
};

/** A labelled row wrapping a picker that reads as a field. */
const Field = PlanFieldRow;

/** Whether a node is a task filed under another task. */
function isSubtask(plan: PlanDraftOut, node: PlanNode): boolean {
  if (node.kind !== 'task' || node.parentRef === null) return false;
  return plan.document.nodes.some((other) => other.ref === node.parentRef && other.kind === 'task');
}

/** What the inspector calls a node: its kind, or Subtask for a task under a task. */
function kindLabel(plan: PlanDraftOut, node: PlanNode): string {
  return isSubtask(plan, node) ? 'Subtask' : KIND_LABEL[node.kind];
}

/** The date field a kind carries, if any. */
interface DateField {
  readonly key: 'targetDate' | 'dueDate';
  readonly label: string;
  readonly placeholder: string;
}

function dateField(kind: PlanNode['kind']): DateField | null {
  if (kind === 'task') return { key: 'dueDate', label: 'Due', placeholder: 'Set due date' };
  if (kind === 'program') return null;
  return { key: 'targetDate', label: 'Target', placeholder: 'Set target date' };
}

/** Props for {@link TemplateField}. */
interface TemplateFieldProps {
  readonly orgId: string;
  readonly node: PlanNode;
  readonly disabled: boolean;
  readonly onApply: PlanInspectorProps['onApply'];
}

/** The templates that create this node's kind, as a picker. */
function TemplateField({ orgId, node, disabled, onApply }: TemplateFieldProps): JSX.Element {
  const templates = useApiListQuery(templatesOfKindDef(orgId, node.kind));
  const options = useMemo<readonly PickerOption[]>(
    () =>
      (templates.data?.items ?? []).map((template) => ({
        value: template.id,
        label: template.name,
        ...(template.description ? { hint: template.description } : {}),
      })),
    [templates.data],
  );
  return (
    <Field label="Template">
      <EnumPicker
        options={options}
        value={node.templateId}
        placeholder={options.length === 0 ? 'No templates' : 'Apply a template'}
        disabled={disabled || options.length === 0}
        triggerVariant="ghost"
        triggerClassName={FIELD_TRIGGER}
        onChange={(templateId) => {
          if (templateId !== null) {
            void onApply([{ op: 'apply_template', ref: node.ref, templateId } as PlanOp]);
          }
        }}
      />
    </Field>
  );
}

/** Props for {@link AlsoInField}. */
interface AlsoInFieldProps {
  readonly plan: PlanDraftOut;
  readonly node: PlanNode;
  readonly initiativeOptions: readonly PickerOption[];
  readonly canEdit: boolean;
  readonly onApply: PlanInspectorProps['onApply'];
}

/** The other initiatives a project belongs to, with a picker to join another. */
function AlsoInField({
  plan,
  node,
  initiativeOptions,
  canEdit,
  onApply,
}: AlsoInFieldProps): JSX.Element {
  const joined = node.initiativeIds.map((id) => ({
    id,
    label: initiativeOptions.find((option) => option.value === id)?.label ?? 'Initiative',
  }));
  const joinable = initiativeOptions.filter(
    (option) =>
      !(node.initiativeIds as readonly string[]).includes(option.value) &&
      option.value !== plan.rootInitiativeId,
  );
  const setMembership = (initiativeIds: readonly string[]): void => {
    void onApply([
      {
        op: 'upsert_node',
        node: { ref: node.ref, kind: 'project', fields: node.fields, initiativeIds },
      } as PlanOp,
    ]);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-on-surface-variant text-label-medium">Also in</span>
      {joined.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {joined.map((entry) => (
            <li
              key={entry.id}
              className="bg-surface-container-high text-on-surface text-label-medium inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2"
            >
              {entry.label}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`Remove from ${entry.label}`}
                  className="hover:bg-surface-container-highest rounded-full p-0.5"
                  onClick={() => {
                    setMembership(node.initiativeIds.filter((id) => id !== entry.id));
                  }}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <EnumPicker
        options={joinable}
        value={null}
        placeholder="Add an initiative"
        searchable
        searchPlaceholder="Search initiatives"
        disabled={!canEdit || joinable.length === 0}
        triggerVariant="ghost"
        triggerClassName={FIELD_TRIGGER}
        onChange={(initiativeId) => {
          if (initiativeId !== null) setMembership([...node.initiativeIds, initiativeId]);
        }}
      />
    </div>
  );
}

/** The read-only inspector for a created node. */
function ConfirmedBody({
  plan,
  node,
}: {
  readonly plan: PlanDraftOut;
  readonly node: PlanNode;
}): JSX.Element {
  const live = plan.objects[node.ref];
  return (
    <div className="flex flex-col gap-4">
      <dl className="text-body-small grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
        <dt className="text-on-surface-variant">Status</dt>
        <dd className="text-on-surface">{live?.statusName ?? 'Created'}</dd>
        {live?.health ? (
          <>
            <dt className="text-on-surface-variant">Health</dt>
            <dd className="text-on-surface">{HEALTH_LABEL[live.health]}</dd>
          </>
        ) : null}
      </dl>
      {live ? (
        <Button asChild variant="secondary" size="sm" className="self-start">
          <Link href={live.href}>
            <OpenInNew className="size-4" /> Open {KIND_LABEL[node.kind].toLowerCase()}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

/** What the draft editor's pieces share. */
type DraftProps = Omit<PlanInspectorProps, 'nodeRef' | 'onClose' | 'onRemove' | 'onAddSubtask'> & {
  readonly node: PlanNode;
  readonly setField: (fields: Record<string, unknown>) => void;
};

/** The text a draft carries: title, summary for a container, description. */
function DraftText({ node, focusTitle = false, canEdit, setField }: DraftProps): JSX.Element {
  return (
    <>
      <CommitText
        id={`plan-title-${node.ref}`}
        autoFocus={focusTitle}
        live
        label="Title"
        value={node.fields.title}
        placeholder={`${KIND_LABEL[node.kind]} name`}
        disabled={!canEdit}
        onCommit={(title) => {
          if (title.length > 0) setField({ title });
        }}
      />
      {node.kind !== 'task' ? (
        <CommitText
          id={`plan-summary-${node.ref}`}
          label="Summary"
          value={node.fields.summary ?? ''}
          placeholder="One line on the outcome"
          disabled={!canEdit}
          onCommit={(summary) => {
            setField({ summary });
          }}
        />
      ) : null}
      <CommitText
        id={`plan-description-${node.ref}`}
        label="Description"
        value={node.fields.description ?? ''}
        multiline
        placeholder="What this is and why it matters"
        disabled={!canEdit}
        onCommit={(description) => {
          setField({ description });
        }}
      />
    </>
  );
}

/** The properties a draft carries: who, when, a template, and a project's other initiatives. */
function DraftProperties(props: DraftProps): JSX.Element {
  const { node, canEdit, memberOptions, setField } = props;
  const date = dateField(node.kind);
  return (
    <>
      <PlanAssignmentFields
        node={node}
        roster={props.roster}
        memberOptions={memberOptions}
        canEdit={canEdit}
        setField={setField}
      />
      {date ? (
        <Field label={date.label}>
          <DatePicker
            value={node.fields[date.key] ?? null}
            placeholder={date.placeholder}
            ariaLabel={`${date.label} date`}
            disabled={!canEdit}
            triggerVariant="ghost"
            triggerClassName={FIELD_TRIGGER}
            onChange={(value) => {
              setField({ [date.key]: value });
            }}
          />
        </Field>
      ) : null}
      <TemplateField orgId={props.orgId} node={node} disabled={!canEdit} onApply={props.onApply} />
      {node.kind === 'project' ? (
        <AlsoInField
          plan={props.plan}
          node={node}
          initiativeOptions={props.initiativeOptions}
          canEdit={canEdit}
          onApply={props.onApply}
        />
      ) : null}
    </>
  );
}

/** The editor for a draft node. */
function DraftBody(
  props: Omit<PlanInspectorProps, 'nodeRef' | 'onClose' | 'onRemove'> & { readonly node: PlanNode },
): JSX.Element {
  const { node, onApply } = props;
  const setField = (fields: Record<string, unknown>): void => {
    void onApply([{ op: 'set_fields', ref: node.ref, fields }]);
  };
  return (
    <div className="flex flex-col gap-4">
      <DraftText {...props} setField={setField} />
      <DraftProperties {...props} setField={setField} />
    </div>
  );
}

/** The one action a draft's inspector keeps reachable: Confirm, naming what it creates. */
function ConfirmFooter({
  plan,
  node,
  committing,
  onConfirm,
}: Pick<PlanInspectorProps, 'plan' | 'committing' | 'onConfirm'> & {
  readonly node: PlanNode;
}): JSX.Element {
  const confirmation = useMemo(
    () => describeConfirmation(plan.document, [node.ref]),
    [plan.document, node.ref],
  );
  return (
    <Button
      type="button"
      size="sm"
      disabled={committing || confirmation.count === 0}
      title={confirmation.label}
      onClick={() => {
        onConfirm([node.ref]);
      }}
    >
      <CheckCircle2 className="size-4" /> Confirm
    </Button>
  );
}

/** Props for {@link DraftMenu}. */
interface DraftMenuProps {
  /** Add a subtask under this task; null for a node that is not a task. */
  readonly onAddSubtask: (() => void) | null;
  /** Whether a subtask may go here: false on a subtask, which carries none of its own. */
  readonly subtaskAllowed: boolean;
  readonly onRemove: () => void;
}

/** The header's overflow: a subtask for a task, and taking a draft out of the plan. */
function DraftMenu({ onAddSubtask, subtaskAllowed, onRemove }: DraftMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" controlSize="xl" iconOnly aria-label="More actions">
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onAddSubtask ? (
          <DropdownMenuItem disabled={!subtaskAllowed} onSelect={onAddSubtask}>
            <Plus />
            Add subtask
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem destructive onSelect={onRemove}>
          <Trash2 />
          Remove from plan
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The inspector for the selected plan node. */
export default function PlanInspector(props: PlanInspectorProps): JSX.Element | null {
  const { plan, nodeRef, canEdit, committing, onConfirm, onRemove, onClose } = props;
  const node = plan.document.nodes.find((candidate) => candidate.ref === nodeRef);
  if (!node) return null;
  const title = plan.objects[node.ref]?.name ?? node.fields.title;
  const draft = node.status === 'draft';
  const kind = kindLabel(plan, node);
  return (
    <CanvasInspector
      title={title}
      leading={<PlanStatusGlyph status={node.status} />}
      closeLabel={`Close ${kind.toLowerCase()} details`}
      onClose={onClose}
      footer={
        draft && canEdit ? (
          <ConfirmFooter plan={plan} node={node} committing={committing} onConfirm={onConfirm} />
        ) : undefined
      }
      actions={
        draft && canEdit ? (
          <DraftMenu
            onAddSubtask={
              node.kind === 'task'
                ? () => {
                    props.onAddSubtask(node.ref);
                  }
                : null
            }
            subtaskAllowed={!isSubtask(plan, node)}
            onRemove={() => {
              onRemove(node.ref);
            }}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-on-surface-variant text-label-medium flex items-center gap-2">
          <span>{kind}</span>
          <PlanStateChip status={node.status} />
        </div>
        {draft ? <DraftBody {...props} node={node} /> : <ConfirmedBody plan={plan} node={node} />}
      </div>
    </CanvasInspector>
  );
}
