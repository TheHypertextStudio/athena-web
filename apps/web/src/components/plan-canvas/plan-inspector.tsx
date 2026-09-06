'use client';

/**
 * `components/plan-canvas/plan-inspector` — the docked editor for one plan node.
 *
 * @remarks
 * For a draft node this is where the fields live: title, summary, description, the accountable
 * person, the date, the template, and for a project the initiatives it also belongs to. Text
 * commits on blur or Enter rather than per keystroke, so a sentence lands as one revision and
 * Athena sees a finished thought. The footer names what Confirm will create and offers the rail.
 *
 * A confirmed node is read-only here: its record is the real one, so the inspector shows what
 * the workspace says about it and sends the person there to edit.
 */
import type { PickerOption } from '@docket/ui/components';
import { ActorPicker, DatePicker, EnumPicker } from '@docket/ui/components';
import { CheckCircle2, OpenInNew, Sparkles, Trash2, X } from '@docket/ui/icons';
import { Button, Input, Textarea } from '@docket/ui/primitives';
import type { PlanDraftOut, PlanNode, PlanOp } from '@docket/work/plan-draft-contract';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { CanvasInspector } from '@/components/canvas/canvas-inspector';
import Link from '@/components/docket-link';
import { HEALTH_LABEL } from '@/components/entity-display/health';
import { templatesOfKindDef } from '@/components/templates/queries';
import { useApiListQuery } from '@/lib/query';

import { describeConfirmation } from './plan-confirm';
import { PlanCreatedMark, PlanDraftPill, PlanStatusGlyph } from './plan-status';

/** Props for {@link PlanInspector}. */
export interface PlanInspectorProps {
  readonly plan: PlanDraftOut;
  /** The selected node's ref. */
  readonly nodeRef: string;
  readonly orgId: string;
  readonly canEdit: boolean;
  readonly committing: boolean;
  /** Human members, for owner, lead, and assignee. */
  readonly memberOptions: readonly PickerOption[];
  /** Existing initiatives a project may also join. */
  readonly initiativeOptions: readonly PickerOption[];
  readonly onApply: (ops: readonly PlanOp[]) => Promise<unknown>;
  readonly onConfirm: (refs: readonly string[]) => void;
  readonly onRemove: (ref: string) => void;
  readonly onAsk: (ref: string) => void;
  readonly onClose: () => void;
}

const KIND_LABEL: Record<PlanNode['kind'], string> = {
  initiative: 'Initiative',
  program: 'Program',
  project: 'Project',
  task: 'Task',
};

/** A text field that commits on blur or Enter and resets on Escape. */
function CommitText({
  id,
  label,
  value,
  multiline = false,
  placeholder,
  disabled,
  onCommit,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly multiline?: boolean;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onCommit: (next: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed !== value) onCommit(trimmed);
  };
  const shared = {
    id,
    value: draft,
    disabled,
    placeholder,
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        setDraft(value);
        event.currentTarget.blur();
      } else if (event.key === 'Enter' && !multiline) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-on-surface-variant text-label-medium">
        {label}
      </label>
      {multiline ? (
        <Textarea
          {...shared}
          rows={3}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      ) : (
        <Input
          {...shared}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      )}
    </div>
  );
}

/** A labelled row wrapping a picker. */
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
      <div className="-ml-2">{children}</div>
    </div>
  );
}

type PersonKey = 'ownerId' | 'leadId' | 'assigneeId';

/** The person field a kind carries. */
function personField(kind: PlanNode['kind']): {
  key: PersonKey;
  label: string;
  placeholder: string;
  clearLabel: string;
} {
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
function dateField(
  kind: PlanNode['kind'],
): { key: 'targetDate' | 'dueDate'; label: string; placeholder: string } | null {
  if (kind === 'task') return { key: 'dueDate', label: 'Due', placeholder: 'Set due date' };
  if (kind === 'program') return null;
  return { key: 'targetDate', label: 'Target', placeholder: 'Set target date' };
}

/** The templates that create this node's kind, as a picker. */
function TemplateField({
  orgId,
  node,
  disabled,
  onApply,
}: {
  readonly orgId: string;
  readonly node: PlanNode;
  readonly disabled: boolean;
  readonly onApply: PlanInspectorProps['onApply'];
}): JSX.Element {
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
        onChange={(templateId) => {
          if (templateId !== null) {
            void onApply([{ op: 'apply_template', ref: node.ref, templateId } as PlanOp]);
          }
        }}
      />
    </Field>
  );
}

/** The other initiatives a project belongs to, with a picker to join another. */
function AlsoInField({
  plan,
  node,
  initiativeOptions,
  canEdit,
  onApply,
}: {
  readonly plan: PlanDraftOut;
  readonly node: PlanNode;
  readonly initiativeOptions: readonly PickerOption[];
  readonly canEdit: boolean;
  readonly onApply: PlanInspectorProps['onApply'];
}): JSX.Element {
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
      <div className="-ml-2">
        <EnumPicker
          options={joinable}
          value={null}
          placeholder="Add an initiative"
          searchable
          searchPlaceholder="Search initiatives"
          disabled={!canEdit || joinable.length === 0}
          onChange={(initiativeId) => {
            if (initiativeId !== null) setMembership([...node.initiativeIds, initiativeId]);
          }}
        />
      </div>
    </div>
  );
}

/** The read-only inspector for a created node. */
function ConfirmedBody({
  plan,
  node,
  onAsk,
}: {
  readonly plan: PlanDraftOut;
  readonly node: PlanNode;
  readonly onAsk: (ref: string) => void;
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
      <div className="flex flex-col gap-2">
        {live ? (
          <Button asChild variant="outline" size="sm">
            <Link href={live.href}>
              <OpenInNew className="size-4" /> Open {KIND_LABEL[node.kind].toLowerCase()}
            </Link>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onAsk(node.ref);
          }}
        >
          <Sparkles className="size-4" /> Ask Athena about this
        </Button>
      </div>
    </div>
  );
}

/** The editor for a draft node. */
function DraftBody({
  plan,
  node,
  orgId,
  canEdit,
  committing,
  memberOptions,
  initiativeOptions,
  onApply,
  onConfirm,
  onRemove,
  onAsk,
}: Omit<PlanInspectorProps, 'nodeRef' | 'onClose'> & { readonly node: PlanNode }): JSX.Element {
  const person = personField(node.kind);
  const date = dateField(node.kind);
  const confirmation = useMemo(
    () => describeConfirmation(plan.document, [node.ref]),
    [plan.document, node.ref],
  );
  const disabled = !canEdit;
  const setField = (fields: Record<string, unknown>): void => {
    void onApply([{ op: 'set_fields', ref: node.ref, fields }]);
  };

  return (
    <div className="flex flex-col gap-4">
      <CommitText
        id={`plan-title-${node.ref}`}
        label="Title"
        value={node.fields.title}
        placeholder={`${KIND_LABEL[node.kind]} name`}
        disabled={disabled}
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
          disabled={disabled}
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
        disabled={disabled}
        onCommit={(description) => {
          setField({ description });
        }}
      />
      <Field label={person.label}>
        <ActorPicker
          options={memberOptions}
          value={node.fields[person.key] ?? null}
          placeholder={person.placeholder}
          clearLabel={person.clearLabel}
          disabled={disabled}
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
            ariaLabel={` date`}
            disabled={disabled}
            onChange={(value) => {
              setField({ [date.key]: value });
            }}
          />
        </Field>
      ) : null}
      <TemplateField orgId={orgId} node={node} disabled={disabled} onApply={onApply} />
      {node.kind === 'project' ? (
        <AlsoInField
          plan={plan}
          node={node}
          initiativeOptions={initiativeOptions}
          canEdit={canEdit}
          onApply={onApply}
        />
      ) : null}
      <div className="border-outline-variant flex flex-col gap-2 border-t pt-3">
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            disabled={committing || confirmation.count === 0}
            onClick={() => {
              onConfirm([node.ref]);
            }}
          >
            <CheckCircle2 className="size-4" /> {confirmation.label}
          </Button>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => {
              onAsk(node.ref);
            }}
          >
            <Sparkles className="size-4" /> Ask Athena
          </Button>
          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-error"
              onClick={() => {
                onRemove(node.ref);
              }}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The inspector for the selected plan node. */
export default function PlanInspector(props: PlanInspectorProps): JSX.Element | null {
  const { plan, nodeRef, onClose } = props;
  const node = plan.document.nodes.find((candidate) => candidate.ref === nodeRef);
  if (!node) return null;
  const title = plan.objects[node.ref]?.name ?? node.fields.title;
  return (
    <CanvasInspector
      title={title}
      leading={<PlanStatusGlyph status={node.status} />}
      closeLabel={`Close ${KIND_LABEL[node.kind].toLowerCase()} details`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <div className="text-on-surface-variant text-label-medium flex items-center gap-2">
          <span>{KIND_LABEL[node.kind]}</span>
          {node.status === 'draft' ? <PlanDraftPill /> : <PlanCreatedMark />}
        </div>
        {node.status === 'draft' ? (
          <DraftBody {...props} node={node} />
        ) : (
          <ConfirmedBody plan={plan} node={node} onAsk={props.onAsk} />
        )}
      </div>
    </CanvasInspector>
  );
}
