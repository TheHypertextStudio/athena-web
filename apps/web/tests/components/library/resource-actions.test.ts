import { describe, expect, it } from 'vitest';
import { OrganizationId, type SearchResult } from '@docket/types';

import { primaryResourceAction } from '@/components/library/resource-actions';

const ORG_ID = OrganizationId.parse('01HZZZ0000000000000000000G');

function resource(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: 'attachment:org:row',
    organizationId: ORG_ID,
    userId: null,
    kind: 'attachment',
    family: 'content',
    title: 'Resource',
    summary: null,
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
    source: null,
    facets: {},
    actions: [{ kind: 'open', label: 'Open', href: `/orgs/${ORG_ID}/tasks/task-1` }],
    score: 0,
    entityId: 'attachment-1',
    externalUrl: null,
    usedIn: [],
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('Library primary resource actions', () => {
  it('opens external resources and URL attachments at the provider', () => {
    for (const row of [
      resource({
        kind: 'external_resource',
        externalUrl: 'https://drive.google.com/file/brief',
        actions: [
          { kind: 'open', label: 'Open', href: `/orgs/${ORG_ID}/library?resourceId=external-1` },
          {
            kind: 'open_external',
            label: 'Open source',
            href: 'https://drive.google.com/file/brief',
          },
        ],
      }),
      resource({
        externalUrl: 'https://example.com/launch-plan',
        facets: { attachmentKind: 'url' },
        actions: [
          { kind: 'open', label: 'Open', href: `/orgs/${ORG_ID}/tasks/task-1` },
          {
            kind: 'open_external',
            label: 'Open source',
            href: 'https://example.com/launch-plan',
          },
        ],
      }),
    ]) {
      expect(primaryResourceAction(row)).toMatchObject({
        kind: 'external',
        href: row.externalUrl,
      });
    }
  });

  it('downloads uploaded files through the authenticated route', () => {
    const href = `/v1/orgs/${ORG_ID}/tasks/task-1/attachments/attachment-1/download`;
    expect(
      primaryResourceAction(
        resource({
          facets: { attachmentKind: 'file', fileName: 'brief.pdf' },
          actions: [
            { kind: 'open', label: 'Open', href: `/orgs/${ORG_ID}/tasks/task-1` },
            { kind: 'download', label: 'Download', href },
          ],
        }),
      ),
    ).toEqual({ kind: 'download', label: 'Download', href });
  });

  it('opens attachments without a provider action at their task, project, or initiative host', () => {
    for (const subjectKind of ['task', 'project', 'initiative'] as const) {
      const subjectId = `${subjectKind}-1`;
      expect(
        primaryResourceAction(
          resource({
            facets: { attachmentKind: subjectKind === 'task' ? 'email' : 'calendar_event' },
            route: {
              type: 'content',
              organizationId: ORG_ID,
              subjectKind,
              subjectId,
              contentKind: 'attachment',
              contentId: 'attachment-1',
              href: `/orgs/${ORG_ID}/${subjectKind}s/${subjectId}`,
            },
            subject: { kind: subjectKind, id: subjectId, title: null, organizationId: ORG_ID },
          }),
        ),
      ).toEqual({
        kind: 'internal',
        label: `Open ${subjectKind}`,
        href: `/orgs/${ORG_ID}/${subjectKind}s/${subjectId}?attachmentId=attachment-1`,
      });
    }
  });
});
