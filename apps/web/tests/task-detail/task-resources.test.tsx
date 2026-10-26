/** Task Resources behavior tests. */
import '@testing-library/jest-dom/vitest';

import { AttachmentOut } from '@docket/work/attachment-contract';
import { EntityMention } from '../../src/lib/contracts/mention';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { ApiRequestError } from '../../src/lib/query-core';
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
  it('shows permission recovery instead of an empty collection or a futile retry', () => {
    render(
      <ResourcesTab
        resources={[]}
        canEdit={false}
        pending={false}
        error="Could not load resources."
        loadFailure={
          new ApiRequestError({
            message: 'Could not load resources.',
            status: 403,
            code: 'forbidden',
          })
        }
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText('No resources yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it('offers a keyboard-accessible retry after a resource read fails', async () => {
    const retry = vi.fn();
    render(
      <ResourcesTab
        resources={[]}
        canEdit={false}
        pending={false}
        error="Could not load resources."
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onRetry={retry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load resources.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('makes file upload reachable by keyboard and passes the selected file to the action', async () => {
    const onUpload = vi.fn();
    const user = userEvent.setup();
    render(
      <ResourcesTab
        resources={[]}
        canEdit
        pending={false}
        error={null}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onUpload={onUpload}
      />,
    );
    const upload = screen.getByRole('button', { name: 'Upload file' });
    await user.tab();
    await user.tab();
    expect(upload).toHaveFocus();
    const file = new File(['Brief'], 'brief.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('File to upload'), file);
    expect(onUpload).toHaveBeenCalledWith(file);
  });

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
