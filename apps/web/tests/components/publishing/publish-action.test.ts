import { PublicationOut } from '@docket/work/publish-contract';
import { describe, expect, it } from 'vitest';

import {
  publicationDialogState,
  resolvedPublicationDialogState,
} from '@/components/publishing/publish-action';
import { publicationStateStatus } from '@/components/publishing/use-publishing';

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
    expect(publicationDialogState(null, 'loading')).toBe('loading');
    expect(publicationDialogState(publication, 'ready')).toBe('published');
    expect(publicationDialogState(null, 'error')).toBe('error');
  });

  it('holds cached publication data until the current dialog opening initializes its slug', () => {
    expect(publicationStateStatus(true, false, true, false)).toBe('loading');
    expect(resolvedPublicationDialogState('published', 2, 1)).toBe('loading');
    expect(resolvedPublicationDialogState('published', 2, 2)).toBe('published');
    expect(resolvedPublicationDialogState('error', 2, 1)).toBe('error');
  });
});
