import type { SearchDocumentKind } from '@docket/types';

import { baseRankFor } from '../rank';
import { entityRoute } from '../routes';
import {
  cleanText,
  type OrgScopedRow,
  preloadedProjector,
  searchDocumentId,
  type SearchDocumentDraft,
  sourceUpdatedAt,
  workVisibility,
} from '../types';

interface NamedWorkRow extends OrgScopedRow {
  name: string;
  description?: string | null;
  ownerId?: string | null;
  leadId?: string | null;
  status?: string | null;
  health?: string | null;
  visibility?: string | null;
}

interface TaskRow extends OrgScopedRow {
  title: string;
  description?: string | null;
  state: string;
  priority?: string | null;
  assigneeId?: string | null;
  delegateId?: string | null;
  teamId: string;
  projectId?: string | null;
  programId?: string | null;
  labelIds?: readonly string[];
  visibility?: string | null;
}

function workDocument(
  row: OrgScopedRow,
  kind: SearchDocumentKind,
  title: string,
  options: {
    summary?: string | null;
    body?: string | null;
    facet?: Record<string, unknown>;
    visibility?: string | null;
  } = {},
): SearchDocumentDraft {
  const facet = options.facet ?? {};
  const routeFacet = Object.fromEntries(
    Object.entries(facet).map(([key, value]) => [key, typeof value === 'string' ? value : null]),
  );
  return {
    id: searchDocumentId(kind, row.organizationId, row.id),
    organizationId: row.organizationId,
    userId: null,
    kind,
    family: 'work',
    sourceTable: kind,
    entityId: row.id,
    subjectKind: null,
    subjectId: null,
    sourceSystem: 'docket',
    externalUrl: null,
    title,
    summary: cleanText(options.summary),
    body: cleanText(options.body),
    facet,
    route: entityRoute(row.organizationId, kind, row.id, routeFacet),
    visibility: workVisibility({ id: row.id, visibility: options.visibility }, kind),
    baseRank: baseRankFor(kind),
    occurredAt: null,
    sourceUpdatedAt: sourceUpdatedAt(row),
    archivedAt: row.archivedAt ?? null,
  };
}

function namedWorkDocument(row: NamedWorkRow, kind: SearchDocumentKind): SearchDocumentDraft {
  return workDocument(row, kind, row.name, {
    summary: row.description,
    body: row.description,
    facet: { ownerId: row.ownerId, leadId: row.leadId, status: row.status, health: row.health },
    visibility: row.visibility,
  });
}

/** Projector for Docket task search documents. */
export const taskSearchProjector = preloadedProjector<TaskRow>('task', (row) => ({
  ...workDocument(row, 'task', row.title, {
    summary: row.description,
    body: row.description,
    facet: {
      state: row.state,
      priority: row.priority,
      assigneeId: row.assigneeId,
      delegateId: row.delegateId,
      teamId: row.teamId,
      projectId: row.projectId,
      programId: row.programId,
      labelIds: row.labelIds ?? [],
    },
    visibility: row.visibility,
  }),
  sourceTable: 'task',
}));

/** Projector for Docket project search documents. */
export const projectSearchProjector = preloadedProjector<NamedWorkRow>('project', (row) => ({
  ...namedWorkDocument(row, 'project'),
  sourceTable: 'project',
}));

/** Projector for Docket program search documents. */
export const programSearchProjector = preloadedProjector<NamedWorkRow>('program', (row) => ({
  ...namedWorkDocument(row, 'program'),
  sourceTable: 'program',
}));

/** Projector for Docket initiative search documents. */
export const initiativeSearchProjector = preloadedProjector<NamedWorkRow>('initiative', (row) => ({
  ...namedWorkDocument(row, 'initiative'),
  sourceTable: 'initiative',
}));

/** Projector for project milestone search documents. */
export const milestoneSearchProjector = preloadedProjector<
  OrgScopedRow & { projectId: string; name: string; targetDate?: Date | null; sort?: number }
>('milestone', (row) => ({
  ...workDocument(row, 'milestone', row.name, {
    summary: row.targetDate?.toISOString() ?? null,
    facet: {
      projectId: row.projectId,
      targetDate: row.targetDate?.toISOString() ?? null,
      sort: row.sort,
    },
  }),
  sourceTable: 'milestone',
  subjectKind: 'project',
  subjectId: row.projectId,
}));

/** Projector for team cycle search documents. */
export const cycleSearchProjector = preloadedProjector<
  OrgScopedRow & {
    teamId: string;
    number: number;
    name?: string | null;
    startsAt: Date;
    endsAt: Date;
    status: string;
  }
>('cycle', (row) => ({
  ...workDocument(row, 'cycle', row.name ?? `Cycle ${row.number}`, {
    summary: `${row.startsAt.toISOString()} - ${row.endsAt.toISOString()}`,
    facet: {
      teamId: row.teamId,
      number: row.number,
      status: row.status,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    },
  }),
  sourceTable: 'cycle',
  subjectKind: 'team',
  subjectId: row.teamId,
}));

/** Projector for organization label search documents. */
export const labelSearchProjector = preloadedProjector<
  OrgScopedRow & { name: string; color: string; group?: string | null; teamId?: string | null }
>('label', (row) => ({
  ...workDocument(row, 'label', row.name, {
    summary: row.group ?? null,
    facet: { color: row.color, group: row.group, teamId: row.teamId },
  }),
  sourceTable: 'label',
  sourceUpdatedAt: row.createdAt ?? null,
}));

/** Projector for saved-view search documents and their serialized filters. */
export const savedViewSearchProjector = preloadedProjector<
  OrgScopedRow & {
    name: string;
    scope: string;
    ownerActorId?: string | null;
    teamId?: string | null;
    filters?: unknown[];
    grouping?: unknown;
    sort?: unknown[];
  }
>('saved_view', (row) => ({
  ...workDocument(row, 'saved_view', row.name, {
    summary: `${row.scope} saved view`,
    facet: {
      scope: row.scope,
      ownerActorId: row.ownerActorId,
      teamId: row.teamId,
      filters: row.filters,
      grouping: row.grouping,
      sort: row.sort,
    },
  }),
  sourceTable: 'saved_view',
}));

/** Search projectors registered for work-family documents. */
export const workSearchProjectors = [
  taskSearchProjector,
  projectSearchProjector,
  programSearchProjector,
  initiativeSearchProjector,
  milestoneSearchProjector,
  cycleSearchProjector,
  labelSearchProjector,
  savedViewSearchProjector,
];
