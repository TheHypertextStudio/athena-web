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
import { ActorPicker, DatePicker, EnumPicker } from '@docket/ui/components';
import { CheckCircle2, Ellipsis, OpenInNew, Trash2, X } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { PlanDraftOut, PlanNode, PlanOp } from '@docket/work/plan-draft-contract';
import { type JSX, useMemo } from 'react';

import { CanvasInspector } from '@/components/canvas/canvas-inspector';
import Link from '@/components/docket-link';
import { HEALTH_LABEL } from '@/components/entity-display/health';
import { templatesOfKindDef } from '@/components/templates/queries';
import { useApiListQuery } from '@/lib/query';

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
  /** Human members, for owner, lead, and assignee. */
  readonly memberOptions: readonly PickerOption[];
  /** Existing initiatives a project may also join. */
  readonly initiativeOptions: readonly PickerOption[];
  readonly onApply: (ops: readonly PlanOp[]) => Promise<unknown>;
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

/** The classes a picker trigger takes so it reads as a field beside the text fields. */
const FIELD_TRIGGER =
  'bg-surface-container-highest hover:bg-surface-container-high w-full justify-start';

/** A labelled row wrapping a picker that reads as a field. */
function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-on-surface-variant text-label-medium">{label}</span>
      {children}
    </div>
  );
}

type PersonKey = 'ownerId' | 'leadId' | 'assigneeId';

/** The person field a kind carries. */
interface PersonField {
  readonly key: PersonKey;
  readonly label: string;
  readonly placeholder: string;
  readonly clearLabel: string;
}

function personField(kind: PlanNode['kind']): PersonField {
  switch (kind) {
    case 'initiative':
    case 'program':
      return { key: 'ownerId', label: 'Owner', placeholder: 'Set owner', clearLabel: 'No owner' };
    case 'project':
      return { key: 'leadId', label: 'Lead', placeholder: 'Set lead', clearLabel: 'No lead' };
    case 'task':
      return {
        key: 'assigneeId',
        label: 'Assignee',
        placeholder: 'Assign',
        clearLabel: 'Unassigned',
      };
  }
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
      <p className="text-on-surface-variant text-body-small">
        This {KIND_LABEL[node.kind].toLowerCase()} exists in the workspace now. Edit it there, or
        ask Athena to change it.
      </p>
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
type DraftProps = Omit<PlanInspectorProps, 'nodeRef' | 'onClose' | 'onRemove'> & {
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
  const person = personField(node.kind);
  const date = dateField(node.kind);
  return (
    <>
      <Field label={person.label}>
        <ActorPicker
          options={memberOptions}
          value={node.fields[person.key] ?? null}
          placeholder={person.placeholder}
          clearLabel={person.clearLabel}
          disabled={!canEdit}
          triggerVariant="ghost"
          triggerClassName={FIELD_TRIGGER}
          onChange={(value) => {
            setField({ [person.key]: value });
          }}
        />
      </Field>
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
  const { plan, node, canEdit, committing, onApply, onConfirm } = props;
  const confirmation = useMemo(
    () => describeConfirmation(plan.document, [node.ref]),
    [plan.document, node.ref],
  );
  const setField = (fields: Record<string, unknown>): void => {
    void onApply([{ op: 'set_fields', ref: node.ref, fields }]);
  };
  return (
    <div className="flex flex-col gap-4">
      <DraftText {...props} setField={setField} />
      <DraftProperties {...props} setField={setField} />
      {canEdit ? (
        <div className="flex justify-end pt-2">
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
        </div>
      ) : null}
    </div>
  );
}

/** The header's overflow: what a draft can be taken out of the plan with. */
function DraftMenu({ onRemove }: { readonly onRemove: () => void }): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" controlSize="xl" iconOnly aria-label="More actions">
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="text-error" onSelect={onRemove}>
          <Trash2 />
          Remove from plan
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The inspector for the selected plan node. */
export default function PlanInspector(props: PlanInspectorProps): JSX.Element | null {
  const { plan, nodeRef, canEdit, onRemove, onClose } = props;
  const node = plan.document.nodes.find((candidate) => candidate.ref === nodeRef);
  if (!node) return null;
  const title = plan.objects[node.ref]?.name ?? node.fields.title;
  const draft = node.status === 'draft';
  return (
    <CanvasInspector
      title={title}
      leading={<PlanStatusGlyph status={node.status} />}
      closeLabel={`Close ${KIND_LABEL[node.kind].toLowerCase()} details`}
      onClose={onClose}
      actions={
        draft && canEdit ? (
          <DraftMenu
            onRemove={() => {
              onRemove(node.ref);
            }}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-on-surface-variant text-label-medium flex items-center gap-2">
          <span>{KIND_LABEL[node.kind]}</span>
          <PlanStateChip status={node.status} />
        </div>
        {draft ? <DraftBody {...props} node={node} /> : <ConfirmedBody plan={plan} node={node} />}
      </div>
    </CanvasInspector>
  );
}
