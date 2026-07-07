/**
 * `stream` — the field catalog for the unified stream (the analogue of `task-catalog.ts`).
 *
 * @remarks
 * Declares the stream's filterable/groupable/sortable fields so the shared {@link FilterToolbar}
 * + URL state work over events. The field `key`s deliberately MATCH the server's
 * `view-filter-sql` whitelist (`system` / `kind` / `entityKind` / `actor` / `occurredAt` /
 * `organizationId`) so a toolbar-built predicate translates straight to SQL. The cross-org
 * personal stream adds a Workspace field; the per-workspace firehose omits it.
 */
import { CanonicalEntityKind, EventKind, PROVIDER_CATALOG } from '@docket/types';

import type { FieldCatalog, FieldDescriptor, FieldOption } from '@/components/views/field-catalog';

import { KIND_LABEL, type StreamEventRow } from './stream-meta';

const SOURCE_LABELS = Object.fromEntries(
  Object.values(PROVIDER_CATALOG).flatMap((entry) =>
    entry.sourceSystem ? [[entry.sourceSystem, entry.name]] : [],
  ),
);

/** The known event sources, shown in the Source filter. */
const SYSTEM_OPTIONS: readonly FieldOption[] = [
  { value: 'docket', label: 'Docket', hint: 'docket' },
  ...['linear', 'github', 'slack', 'discord', 'google_calendar', 'gmail', 'outlook'].map(
    (source) => ({
      value: source,
      label: SOURCE_LABELS[source] ?? source,
      hint: source,
    }),
  ),
];

/** Canonical kinds, shown in the Kind filter. */
const KIND_OPTIONS: readonly FieldOption[] = EventKind.options.map((kind) => ({
  value: kind,
  label: KIND_LABEL[kind],
  hint: kind,
}));

/** Human label per canonical entity kind (for the Subject filter). */
const ENTITY_KIND_LABEL: Record<CanonicalEntityKind, string> = {
  work_item: 'Work item',
  project: 'Project',
  program: 'Program',
  initiative: 'Initiative',
  cycle: 'Cycle',
  thread: 'Thread',
  message: 'Message',
  document: 'Document',
  calendar_event: 'Calendar event',
  person: 'Person',
  organization: 'Organization',
};

/** Canonical entity kinds, shown in the Subject filter. */
const ENTITY_KIND_OPTIONS: readonly FieldOption[] = CanonicalEntityKind.options.map((kind) => ({
  value: kind,
  label: ENTITY_KIND_LABEL[kind],
  hint: kind,
}));

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
      key: 'system',
      label: 'Source',
      type: 'enum',
      accessor: (r) => r.system,
      groupable: true,
      options: SYSTEM_OPTIONS,
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
      key: 'entityKind',
      label: 'Subject',
      type: 'enum',
      accessor: (r) => r.entityKind,
      options: ENTITY_KIND_OPTIONS,
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
