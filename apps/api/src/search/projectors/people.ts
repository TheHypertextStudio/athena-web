import { baseRankFor } from '../rank';
import { entityRoute } from '../routes';
import {
  cleanText,
  type OrgScopedRow,
  preloadedProjector,
  searchDocumentId,
  type SearchDocumentDraft,
  sourceUpdatedAt,
} from '../types';

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  purpose?: string | null;
  updatedAt?: Date | null;
  archivedAt?: Date | null;
}

function peopleDocument(
  row: {
    id: string;
    organizationId: string;
    updatedAt?: Date | null;
    createdAt?: Date | null;
    archivedAt?: Date | null;
  },
  kind: SearchDocumentDraft['kind'],
  title: string,
  options: {
    summary?: string | null;
    body?: string | null;
    facet?: Record<string, unknown>;
  } = {},
): SearchDocumentDraft {
  return {
    id: searchDocumentId(kind, row.organizationId, row.id),
    organizationId: row.organizationId,
    userId: null,
    kind,
    family: 'people',
    sourceTable: kind,
    entityId: row.id,
    subjectKind: null,
    subjectId: null,
    sourceSystem: 'docket',
    externalUrl: null,
    title,
    summary: cleanText(options.summary),
    body: cleanText(options.body),
    facet: options.facet ?? {},
    route: entityRoute(row.organizationId, kind, row.id),
    visibility: { mode: 'org_members' },
    baseRank: baseRankFor(kind),
    occurredAt: null,
    sourceUpdatedAt: sourceUpdatedAt(row),
    archivedAt: row.archivedAt ?? null,
  };
}

/** Projects organizations into searchable people documents. */
export const organizationSearchProjector = preloadedProjector<OrganizationRow>(
  'organization',
  (row) => ({
    ...peopleDocument(
      { ...row, organizationId: row.id, createdAt: null },
      'organization',
      row.name,
      { summary: row.purpose ?? row.slug, body: row.purpose, facet: { slug: row.slug } },
    ),
    sourceTable: 'organization',
  }),
);

/** Projects teams into searchable people documents. */
export const teamSearchProjector = preloadedProjector<
  OrgScopedRow & { name: string; key: string; description?: string | null }
>('team', (row) => ({
  ...peopleDocument(row, 'team', row.name, {
    summary: row.description ?? row.key,
    body: row.description,
    facet: { key: row.key },
  }),
  sourceTable: 'team',
}));

/** Projects human organization members into searchable people documents. */
export const memberSearchProjector = preloadedProjector<
  OrgScopedRow & {
    kind: string;
    displayName: string;
    userId?: string | null;
    roleId?: string | null;
    status: string;
  }
>('actor', (row) => {
  if (row.kind !== 'human') return null;
  return {
    ...peopleDocument(row, 'member', row.displayName, {
      summary: row.status,
      facet: { actorKind: row.kind, userId: row.userId, roleId: row.roleId, status: row.status },
    }),
    sourceTable: 'actor',
    userId: row.userId ?? null,
  };
});

/** Projects agents into searchable people documents. */
export const agentSearchProjector = preloadedProjector<
  OrgScopedRow & {
    actorId: string;
    guidance?: string | null;
    approvalPolicy?: string | null;
    accountableOwnerId?: string | null;
  }
>('agent', (row) => ({
  ...peopleDocument(row, 'agent', `Agent ${row.id}`, {
    summary: row.guidance,
    body: row.guidance,
    facet: {
      actorId: row.actorId,
      approvalPolicy: row.approvalPolicy,
      accountableOwnerId: row.accountableOwnerId,
    },
  }),
  sourceTable: 'agent',
}));

/** Projects agent sessions into searchable people documents. */
export const agentSessionSearchProjector = preloadedProjector<{
  id: string;
  organizationId: string;
  agentId: string;
  taskId?: string | null;
  trigger: string;
  status: string;
  createdAt?: Date | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
}>('agent_session', (row) => ({
  ...peopleDocument(row, 'agent_session', `Agent session ${row.id}`, {
    summary: row.status,
    facet: {
      agentId: row.agentId,
      taskId: row.taskId,
      trigger: row.trigger,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
    },
  }),
  sourceTable: 'agent_session',
  subjectKind: row.taskId ? 'task' : 'agent',
  subjectId: row.taskId ?? row.agentId,
}));

/** Search projectors registered for people sources. */
export const peopleSearchProjectors = [
  organizationSearchProjector,
  teamSearchProjector,
  memberSearchProjector,
  agentSearchProjector,
  agentSessionSearchProjector,
];
