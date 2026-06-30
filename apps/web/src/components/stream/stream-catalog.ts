/**
 * `stream` — the field catalog for the unified stream (the analogue of `task-catalog.ts`).
 *
 * @remarks
 * Declares the stream's filterable/groupable/sortable fields so the shared {@link FilterToolbar}
 * + URL state work over events. The field `key`s deliberately MATCH the server's
 * `view-filter-sql` whitelist (`provider` / `kind` / `subjectType` / `actor` / `occurredAt` /
 * `organizationId`) so a toolbar-built predicate translates straight to SQL. The cross-org
 * personal stream adds a Workspace field; the per-workspace firehose omits it.
 */
import { ObservationKind } from '@docket/types';

import type { FieldCatalog, FieldDescriptor, FieldOption } from '@/components/views/field-catalog';

import { KIND_LABEL, type StreamEventRow } from './stream-meta';

/** The known event sources, shown in the Source filter. */
const PROVIDER_OPTIONS: readonly FieldOption[] = [
  { value: 'docket', label: 'Docket', hint: 'docket' },
  { value: 'linear', label: 'Linear', hint: 'linear' },
  { value: 'slack', label: 'Slack', hint: 'slack' },
  { value: 'github', label: 'GitHub', hint: 'github' },
];

/** Canonical kinds, shown in the Kind filter. */
const KIND_OPTIONS: readonly FieldOption[] = ObservationKind.options.map((kind) => ({
  value: kind,
  label: KIND_LABEL[kind],
  hint: kind,
}));

/** Subject kinds worth filtering by (a curated subset of the freeform subject types). */
const SUBJECT_OPTIONS: readonly FieldOption[] = [
  { value: 'project', label: 'Project' },
  { value: 'initiative', label: 'Initiative' },
  { value: 'program', label: 'Program' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'task', label: 'Task' },
  { value: 'issue', label: 'Issue' },
  { value: 'comment', label: 'Comment' },
  { value: 'channel', label: 'Channel' },
];

/** Dependencies the page supplies (cross-org workspace resolution). */
export interface StreamCatalogDeps {
  /** `me` adds the Workspace field; `org` omits it. */
  readonly scope: 'me' | 'org';
  /** Workspace options for the cross-org stream (the caller's orgs). */
  readonly orgOptions?: () => readonly FieldOption[];
  /** Resolve an org id to its display name for chips/group headers. */
  readonly resolveOrgName?: (orgId: string) => string;
}

/**
 * Build the stream field catalog for a scope.
 *
 * @param deps - Scope + cross-org workspace resolution.
 * @returns the catalog the toolbar + URL codec read.
 */
export function buildStreamCatalog(deps: StreamCatalogDeps): FieldCatalog<StreamEventRow> {
  const fields: FieldDescriptor<StreamEventRow>[] = [
    {
      key: 'provider',
      label: 'Source',
      type: 'enum',
      accessor: (r) => r.provider,
      groupable: true,
      options: PROVIDER_OPTIONS,
    },
    {
      key: 'kind',
      label: 'Kind',
      type: 'enum',
      accessor: (r) => r.kind,
      groupable: true,
      options: KIND_OPTIONS,
    },
    {
      key: 'subjectType',
      label: 'Subject',
      type: 'enum',
      accessor: (r) => r.subjectType,
      options: SUBJECT_OPTIONS,
    },
    {
      key: 'actor',
      label: 'Person',
      type: 'text',
      accessor: (r) => r.actorName,
    },
    {
      key: 'occurredAt',
      label: 'Time',
      type: 'date',
      accessor: (r) => r.occurredAt,
      sortable: true,
    },
  ];

  if (deps.scope === 'me') {
    fields.splice(2, 0, {
      key: 'organizationId',
      label: 'Workspace',
      type: 'relation',
      accessor: (r) => r.organizationId,
      groupable: true,
      ...(deps.orgOptions ? { resolveOptions: deps.orgOptions } : {}),
      ...(deps.resolveOrgName ? { resolveLabel: deps.resolveOrgName } : {}),
    });
  }

  return fields;
}
