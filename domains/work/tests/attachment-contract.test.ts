import { describe, expect, it } from 'vitest';

import {
  AttachmentCreate,
  AttachmentOut,
  AttachmentSubjectType,
} from '../src/contracts/attachment';
import {
  DocumentImageMimeType,
  DocumentImageOut,
  DocumentImageRemoved,
} from '../src/contracts/document-image';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('attachment contracts', () => {
  it('enforces the fields required by each pointer kind', () => {
    expect(
      AttachmentCreate.parse({ kind: 'url', title: 'Reference', url: 'https://example.com' }).kind,
    ).toBe('url');
    expect(AttachmentCreate.safeParse({ kind: 'url', title: 'Reference' }).success).toBe(false);
    expect(
      AttachmentCreate.parse({
        kind: 'email',
        title: 'Thread',
        sourceIntegrationId: ID,
        externalId: 'thread-1',
      }).kind,
    ).toBe('email');
    expect(AttachmentCreate.safeParse({ kind: 'email', title: 'Thread' }).success).toBe(false);
    expect(
      AttachmentCreate.parse({ kind: 'calendar_event', title: 'Review', externalId: 'event-1' })
        .kind,
    ).toBe('calendar_event');
    expect(AttachmentCreate.safeParse({ kind: 'calendar_event', title: 'Review' }).success).toBe(
      false,
    );
  });

  it('keeps attachment subjects and read models closed', () => {
    expect(AttachmentSubjectType.parse('initiative')).toBe('initiative');
    expect(AttachmentSubjectType.safeParse('organization').success).toBe(false);
    expect(
      AttachmentOut.parse({
        id: ID,
        organizationId: ID,
        subjectType: 'task',
        subjectId: ID,
        kind: 'url',
        title: 'Reference',
        url: 'https://example.com',
        sourceIntegrationId: null,
        externalId: null,
        metadata: null,
        fileName: null,
        mimeType: null,
        byteSize: null,
        createdAt: '2026-08-31T12:00:00.000Z',
      }).kind,
    ).toBe('url');
  });

  it('permits only inline-safe raster document images', () => {
    expect(DocumentImageMimeType.parse('image/webp')).toBe('image/webp');
    expect(DocumentImageMimeType.safeParse('image/svg+xml').success).toBe(false);
    expect(
      DocumentImageOut.parse({
        id: ID,
        organizationId: ID,
        url: '/v1/document-images/image',
        mimeType: 'image/png',
        byteSize: 512,
        fileName: 'image.png',
        createdAt: '2026-08-31T12:00:00.000Z',
      }).byteSize,
    ).toBe(512);
    expect(DocumentImageRemoved.parse({ id: ID, removed: true }).removed).toBe(true);
  });
});
