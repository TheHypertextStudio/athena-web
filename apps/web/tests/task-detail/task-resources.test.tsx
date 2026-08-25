/** Task Resources behavior tests. */
import '@testing-library/jest-dom/vitest';

import { AttachmentOut, EntityMention } from '@docket/types';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResourcesTab } from '../../src/components/entity-detail/resources-tab';

afterEach(cleanup);

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TASK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const FILE_ATTACHMENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1';

const attachments: readonly AttachmentOut[] = [
  {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    organizationId: ORG_ID,
    subjectType: 'task',
    subjectId: TASK_ID,
    kind: 'url',
    title: 'Release plan',
    url: 'https://example.test/release?utm_source=mail',
    sourceIntegrationId: null,
    externalId: null,
    metadata: null,
    fileName: null,
    mimeType: null,
    byteSize: null,
    createdAt: '2026-08-24T12:00:00.000Z',
  },
  {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
    organizationId: ORG_ID,
    subjectType: 'task',
    subjectId: TASK_ID,
    kind: 'url',
    title: 'Release plan duplicate',
    url: 'https://example.test/release',
    sourceIntegrationId: null,
    externalId: null,
    metadata: null,
    fileName: null,
    mimeType: null,
    byteSize: null,
    createdAt: '2026-08-24T12:01:00.000Z',
  },
  {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
    organizationId: ORG_ID,
    subjectType: 'task',
    subjectId: TASK_ID,
    kind: 'email',
    title: 'Vendor approval',
    url: 'https://mail.example.test/thread/1',
    sourceIntegrationId: 'integration_1',
    externalId: 'thread_1',
    metadata: { sender: 'Ada Lovelace' },
    fileName: null,
    mimeType: null,
    byteSize: null,
    createdAt: '2026-08-24T12:02:00.000Z',
  },
  {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    organizationId: ORG_ID,
    subjectType: 'task',
    subjectId: TASK_ID,
    kind: 'calendar_event',
    title: 'Launch review',
    url: 'https://calendar.example.test/event/1',
    sourceIntegrationId: null,
    externalId: 'event_1',
    metadata: { startsAt: '2026-08-25T17:00:00.000Z' },
    fileName: null,
    mimeType: null,
    byteSize: null,
    createdAt: '2026-08-24T12:03:00.000Z',
  },
  {
    id: FILE_ATTACHMENT_ID,
    organizationId: ORG_ID,
    subjectType: 'task',
    subjectId: TASK_ID,
    kind: 'file',
    title: 'Budget workbook',
    url: null,
    sourceIntegrationId: null,
    externalId: null,
    metadata: null,
    fileName: 'budget.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteSize: 512,
    createdAt: '2026-08-24T12:04:00.000Z',
  },
].map((attachment) => AttachmentOut.parse(attachment));

const mentionedExternal: readonly EntityMention[] = [
  {
    key: 'resource:release',
    label: 'Release plan',
    href: 'https://example.test/release',
    fields: ['description'],
    occurrences: 1,
    ref: { kind: 'external', url: 'https://example.test/release' },
    resource: {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
      organizationId: ORG_ID,
      provider: 'web',
      canonicalUrl: 'https://example.test/release',
      canonicalKey: 'web:https://example.test/release',
      externalId: null,
      resourceType: 'page',
      title: 'Release plan',
      description: null,
      siteName: null,
      iconUrl: null,
      thumbnailUrl: null,
      mimeType: null,
      ownerLabel: null,
      externalUpdatedAt: null,
      unfurlStatus: 'pending',
      fetchedAt: null,
      createdAt: '2026-08-24T12:00:00.000Z',
      updatedAt: '2026-08-24T12:00:00.000Z',
    },
  },
].map((mention) => EntityMention.parse(mention));

describe('task Resources', () => {
  it('shows task attachments and description references once in one collection', () => {
    render(
      <ResourcesTab
        resources={attachments}
        canEdit
        pending={false}
        error={null}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        downloadHref={(attachmentId) => `/download/${attachmentId}`}
        mentionedExternal={mentionedExternal}
        hasProse
      />,
    );

    const resources = screen.getByRole('heading', { name: 'Resources' }).closest('div');
    expect(resources).not.toBeNull();
    expect(screen.getAllByRole('link', { name: 'Release plan' })).toHaveLength(1);
    expect(screen.getByText(/^Email/)).toBeInTheDocument();
    expect(screen.getByText(/^Calendar/)).toBeInTheDocument();
    expect(screen.getByText(/^File/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download Budget workbook' })).toHaveAttribute(
      'href',
      `/download/${FILE_ATTACHMENT_ID}`,
    );
    expect(within(resources as HTMLElement).queryByText('Mentioned in this record')).toBeNull();
  });
});
