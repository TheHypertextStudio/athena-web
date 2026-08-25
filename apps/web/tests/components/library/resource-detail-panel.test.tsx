import '@testing-library/jest-dom/vitest';

import { OrganizationId, type SearchResult } from '@docket/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const queryDefinitions: unknown[] = [];

vi.mock('@/lib/query', () => ({
  queryKeys: { references: (...parts: string[]) => ['references', ...parts] },
  apiQueryOptions: (
    queryKey: unknown,
    queryFn: unknown,
    message: string,
    options?: { enabled?: boolean },
  ) => ({ queryKey, queryFn, message, ...options }),
  useApiQuery: (definition: { enabled?: boolean }) => {
    queryDefinitions.push(definition);
    return {
      isPending: false,
      error: null,
      data: { total: 0, groups: [] },
    };
  },
}));

vi.mock('@/lib/api', () => ({ api: { v1: { orgs: {} } } }));

import ResourceDetailPanel from '@/components/library/resource-detail-panel';

const ORG_ID = OrganizationId.parse('01HZZZ0000000000000000000G');

function fileAttachment(): SearchResult {
  const href = `/v1/orgs/${ORG_ID}/tasks/task-1/attachments/attachment-1/download`;
  return {
    id: `attachment:${ORG_ID}:attachment-1`,
    organizationId: ORG_ID,
    userId: null,
    kind: 'attachment',
    family: 'content',
    title: 'Launch brief',
    summary: 'file',
    snippet: null,
    matchedFields: [],
    route: {
      type: 'content',
      organizationId: ORG_ID,
      subjectKind: 'task',
      subjectId: 'task-1',
      contentKind: 'attachment',
      contentId: 'attachment-1',
      href: `/orgs/${ORG_ID}/search?attachmentId=attachment-1`,
    },
    subject: { kind: 'task', id: 'task-1', title: null, organizationId: ORG_ID },
    source: { system: 'docket', externalUrl: null, eventId: null },
    facets: {
      attachmentKind: 'file',
      fileName: 'launch-brief.pdf',
      mimeType: 'application/pdf',
      byteSize: 48_721,
    },
    actions: [
      { kind: 'open', label: 'Open', href: `/orgs/${ORG_ID}/tasks/task-1` },
      { kind: 'download', label: 'Download', href },
    ],
    score: 0,
    entityId: 'attachment-1',
    externalUrl: null,
    usedIn: [{ kind: 'initiative', id: 'initiative-1', title: 'Q3 launch' }],
    updatedAt: '2026-08-20T12:00:00.000Z',
  };
}

function externalResource(): SearchResult {
  return {
    id: `external_resource:${ORG_ID}:resource-1`,
    organizationId: ORG_ID,
    userId: null,
    kind: 'external_resource',
    family: 'content',
    title: 'Launch plan',
    summary: null,
    snippet: null,
    matchedFields: [],
    route: { type: 'external', externalUrl: 'https://example.test/launch-plan' },
    subject: null,
    source: null,
    facets: { provider: 'web' },
    actions: [
      { kind: 'open_external', label: 'Open source', href: 'https://example.test/launch-plan' },
    ],
    score: 0,
    entityId: 'resource-1',
    externalUrl: 'https://example.test/launch-plan',
    usedIn: [],
    updatedAt: '2026-08-20T12:00:00.000Z',
  };
}

describe('ResourceDetailPanel attachments', () => {
  it('shows the host, file action, and work context without querying attachment backlinks', () => {
    queryDefinitions.length = 0;
    render(<ResourceDetailPanel orgId={ORG_ID} resource={fileAttachment()} onClose={vi.fn()} />);

    expect(screen.getByRole('link', { name: /Download/ })).toHaveAttribute(
      'href',
      `/v1/orgs/${ORG_ID}/tasks/task-1/attachments/attachment-1/download`,
    );
    expect(screen.getByRole('link', { name: /Open task/ })).toHaveAttribute(
      'href',
      `/orgs/${ORG_ID}/tasks/task-1?attachmentId=attachment-1`,
    );
    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    expect(screen.queryByText('Referenced by')).not.toBeInTheDocument();
    expect(queryDefinitions).toHaveLength(1);
    expect(queryDefinitions[0]).toMatchObject({ enabled: false });
  });

  it('calls direct attachments and prose references resource uses', () => {
    queryDefinitions.length = 0;
    render(<ResourceDetailPanel orgId={ORG_ID} resource={externalResource()} onClose={vi.fn()} />);

    expect(screen.getByText('Used by')).toBeInTheDocument();
    expect(screen.queryByText('Referenced by')).not.toBeInTheDocument();
    expect(queryDefinitions).toHaveLength(1);
    expect(queryDefinitions[0]).toMatchObject({ enabled: true });
  });
});
