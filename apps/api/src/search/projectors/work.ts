import { defaultCycleName, type SearchDocumentKind } from '@docket/types';

import { markdownToPlainText } from '../../content/markdown-links';
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
  // The entity's own authored plain-text blurb — distinct from `description`, which is the full
  // Markdown body. Preferred for the search document's `summary` (and thus any preview that reads
  // it, like a mention hovercard) so a preview never has to render raw Markdown source.
  summary?: string | null | undefined;
  description?: string | null | undefined;
  ownerId?: string | null | undefined;
  leadId?: string | null | undefined;
  status?: string | null | undefined;
  health?: string | null | undefined;
  visibility?: string | null | undefined;
  startDate?: Date | null | undefined;
  startDateResolution?: string | null | undefined;
  startDateFiscalYearStartMonth?: number | null | undefined;
  targetDate?: Date | null | undefined;
  targetDateResolution?: string | null | undefined;
  targetDateFiscalYearStartMonth?: number | null | undefined;
}

/**
 * The plain-text blurb a preview surface should show for a work object.
 *
 * @remarks
 * Prefers the entity's own authored `summary` — it's already plain text by design — and only
 * falls back to deriving one from the Markdown `description` when no summary was written. `body`
 * (full-text search) keeps the untruncated Markdown regardless; only the *display* excerpt needs
 * flattening.
 */
function displaySummary(
  summary: string | null | undefined,
  description: string | null | undefined,
): string | null {
  const authored = summary?.trim();
  if (authored) return authored;
  return description ? markdownToPlainText(description) || null : null;
}

interface TaskRow extends OrgScopedRow {
  title: string;
  description?: string | null | undefined;
  state: string;
  priority?: string | null | undefined;
  assigneeId?: string | null | undefined;
  delegateId?: string | null | undefined;
  teamId: string;
  projectId?: string | null | undefined;
  programId?: string | null | undefined;
  labelIds?: readonly string[] | undefined;
  visibility?: string | null | undefined;
}

function workDocument(
  row: OrgScopedRow,
  kind: SearchDocumentKind,
  title: string,
  options: {
    summary?: string | null | undefined;
    body?: string | null | undefined;
    facet?: Record<string, unknown> | undefined;
    visibility?: string | null | undefined;
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
  const timeframeFacet = {
    ...(row.startDate !== undefined
      ? {
          startDate: row.startDate?.toISOString() ?? null,
          startDateResolution: row.startDateResolution ?? null,
          startDateFiscalYearStartMonth: row.startDateFiscalYearStartMonth ?? null,
        }
      : {}),
    ...(row.targetDate !== undefined
      ? {
          targetDate: row.targetDate?.toISOString() ?? null,
          targetDateResolution: row.targetDateResolution ?? null,
          targetDateFiscalYearStartMonth: row.targetDateFiscalYearStartMonth ?? null,
        }
      : {}),
  };
  return workDocument(row, kind, row.name, {
    summary: displaySummary(row.summary, row.description),
    body: row.description,
    facet: {
      ownerId: row.ownerId,
      leadId: row.leadId,
      status: row.status,
      health: row.health,
      ...timeframeFacet,
    },
    visibility: row.visibility,
  });
}

/** Projector for Docket task search documents. */
export const taskSearchProjector = preloadedProjector<TaskRow>('task', (row) => ({
  ...workDocument(row, 'task', row.title, {
    // Task has no dedicated plain-text summary column, so the excerpt always derives from the
    // Markdown description — the same rule `displaySummary` applies to Project/Program/Initiative,
    // just with no authored summary ever available to prefer.
    summary: displaySummary(undefined, row.description),
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
  OrgScopedRow & {
    projectId: string;
    name: string;
    description?: string | null | undefined;
    targetDate?: Date | null | undefined;
    sort?: number | undefined;
  }
>('milestone', (row) => ({
  ...workDocument(row, 'milestone', row.name, {
    summary: row.targetDate?.toISOString() ?? null,
    body: row.description ?? null,
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

/**
 * Projector for team cycle search documents.
 *
 * @remarks
 * An unnamed cycle is titled by its window rather than its `number`: the number is the
 * epoch-anchored auto-roll key (1000137), so indexing it as the title made every unnamed cycle
 * unsearchable by anything a person would type. `number` stays on the facet as a machine handle.
 */
export const cycleSearchProjector = preloadedProjector<
  OrgScopedRow & {
    teamId: string;
    number: number;
    name?: string | null | undefined;
    startsAt: Date;
    endsAt: Date;
    status: string;
  }
>('cycle', (row) => ({
  ...workDocument(row, 'cycle', row.name ?? defaultCycleName(row.startsAt, row.endsAt), {
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
  OrgScopedRow & {
    name: string;
    color: string;
    group?: string | null | undefined;
    teamId?: string | null | undefined;
  }
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
    ownerActorId?: string | null | undefined;
    teamId?: string | null | undefined;
    filters?: unknown[] | undefined;
    grouping?: unknown;
    sort?: unknown[] | undefined;
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
