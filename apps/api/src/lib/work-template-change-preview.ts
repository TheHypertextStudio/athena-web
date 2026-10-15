import { createHash } from 'node:crypto';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  WorkTemplateChangePreview,
  type WorkTemplateChangeField,
  type WorkTemplateChangeRequest,
  type WorkTemplateFieldChange,
} from '@docket/work/work-template-reference';
import type { TemplateTransaction } from './templates/persistence';
import type { TemplateWorkRow } from './work-template-selection';
import { prepareWorkTemplateCreation } from './work-template-creation';
import {
  labelsForSubject,
  resolveLabelSet,
  resolveLabelCatalog,
  type ResolvedLabel,
  type ScopedResolvedLabel,
  type LabelRefRow,
} from './labels';

const FIELD_LABELS: Record<WorkTemplateChangeField, string> = {
  title: 'Title',
  name: 'Name',
  summary: 'Summary',
  description: 'Starting document',
  priority: 'Priority',
  health: 'Health',
  status: 'Status',
  labels: 'Labels',
  visibility: 'Visibility',
  updateCadence: 'Update cadence',
};

/** Private application values paired with their bounded, authorized preview differences. */
export interface PreparedTemplateChange {
  readonly preview: WorkTemplateChangePreview;
  readonly values: Readonly<Record<string, unknown>>;
  readonly labels: readonly ResolvedLabel[];
}

/** Compute optional differences from the exact publication; no absent default erases existing work. */
export async function prepareTemplateChange(
  tx: TemplateTransaction,
  kind: TemplateTargetType,
  current: TemplateWorkRow,
  {
    teamId,
    selection,
    publication,
  }: {
    readonly teamId: string | null;
    readonly selection: WorkTemplateChangeRequest;
    readonly publication: { id: string; definition: WorkTemplateDefinition };
  },
): Promise<PreparedTemplateChange> {
  const prepared = await prepareWorkTemplateCreation(
    current.organizationId,
    kind,
    {
      workTypeId: selection.workTypeId,
      workTypeVersionId: publication.id,
      teamId: teamId ?? undefined,
    },
    tx,
  );
  const values = startingValues(publication.definition, { ...prepared });
  const existing = await labelsForSubject(kind, current.organizationId, current.id, tx);
  const labels = await resolveLabelSet(
    current.organizationId,
    Array.isArray(values['labels']) ? (values['labels'] as string[]) : [],
    { teamId, dbh: tx },
  );
  const catalog = await resolveLabelCatalog(
    current.organizationId,
    [...existing, ...labels].map((label) => label.id),
    tx,
  );
  const before: Readonly<Record<string, unknown>> = current;
  const changes = Object.entries(values).flatMap(([field, after]) => {
    const key = field as WorkTemplateChangeField;
    const previous = field === 'status' && kind === 'task' ? before['state'] : before[field];
    const difference: WorkTemplateFieldChange = {
      field: key,
      label: FIELD_LABELS[key],
      before: field === 'labels' ? labelDisplayValues(existing, catalog) : displayValue(previous),
      after: field === 'labels' ? labelDisplayValues(labels, catalog) : displayValue(after),
    };
    const equal =
      field === 'labels'
        ? labelIdentity(existing) === labelIdentity(labels)
        : JSON.stringify(difference.before) === JSON.stringify(difference.after);
    return equal ? [] : [difference];
  });
  const token = createHash('sha256')
    .update(JSON.stringify({ current, existing, publicationId: publication.id, values, changes }))
    .digest('hex');
  return {
    values,
    labels,
    preview: WorkTemplateChangePreview.parse({
      workTypeId: selection.workTypeId,
      workTypeVersionId: publication.id,
      previewToken: `sha256:${token}`,
      changes,
    }),
  };
}

function startingValues(
  definition: WorkTemplateDefinition,
  prepared: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(definition.payload)) {
    if (hasStartingValue(key, prepared[key])) values[key] = prepared[key];
  }
  if (definition.payload.targetType === 'task' && definition.payload.labelIds !== undefined)
    values['labels'] = prepared['labels'];
  if (definition.defaultStatusKey !== null || 'status' in definition.payload)
    values['status'] = prepared[definition.payload.targetType === 'task' ? 'state' : 'status'];
  return values;
}

function displayValue(value: unknown): WorkTemplateFieldChange['before'] {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return null;
}

function hasStartingValue(key: string, value: unknown): boolean {
  if (!(key in FIELD_LABELS) || key === 'status' || value === undefined) return false;
  if (key === 'title' || key === 'name')
    return typeof value === 'string' && value.trim().length > 0;
  return true;
}

function labelIdentity(labels: readonly LabelRefRow[]): string {
  return labels
    .map((label) => label.id)
    .sort()
    .join(',');
}

function labelDisplayValues(
  labels: readonly LabelRefRow[],
  catalog: readonly ScopedResolvedLabel[],
): string[] {
  return labels.map((label) => {
    const matching = catalog.filter((item) => item.name === label.name);
    if (matching.length < 2) return label.name;
    return `${label.name} · ${matching.find((item) => item.id === label.id)?.teamId ? 'Team label' : 'Workspace label'}`;
  });
}
