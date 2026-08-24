import { PublicationOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { publicationDialogState } from '@/components/publishing/publish-action';

const publication = PublicationOut.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  subjectKind: 'program',
  subjectId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  slug: 'service-operations',
  published: true,
  publishedAt: '2026-08-23T12:00:00.000Z',
  unpublishedAt: null,
  path: '/service-operations',
  urls: [],
});

describe('publicationDialogState', () => {
  it('does not expose a publish action while an initially empty publication cache resolves', () => {
    expect(publicationDialogState(null, true)).toBe('loading');
    expect(publicationDialogState(publication, false)).toBe('published');
  });
});
