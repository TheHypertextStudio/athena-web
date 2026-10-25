import { beforeEach, expect, it } from 'vitest';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId } from '@docket/work/ids';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import {
  createSourceCopy,
  readSourceCopy,
  sourceCopyChoices,
  writeSourceCopy,
} from '@/components/templates/source-copy/source-copy-session';
import { galleryFixture } from '../gallery/gallery-fixture';
const owner = { userId: 'person', sessionId: 'session' };
const source = {
  kind: 'draft' as const,
  organizationId: OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  workTypeId: WorkTypeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'),
};
beforeEach(() => {
  window.sessionStorage.clear();
});
it('retains only exact choices for the same account/session and opaque flow', () => {
  const attempt = createSourceCopy(owner, source);
  expect(readSourceCopy(owner, attempt.id)).toEqual(attempt);
  expect(readSourceCopy({ ...owner, sessionId: 'other' }, attempt.id)).toBeNull();
  expect(readSourceCopy({ ...owner, userId: 'other' }, attempt.id)).toBeNull();
  expect(readSourceCopy(owner, 'not-an-attempt')).toBeNull();
  writeSourceCopy(owner, { ...attempt, destinationOrgId: source.organizationId });
  expect(readSourceCopy(owner, attempt.id)?.destinationOrgId).toBe(source.organizationId);
  expect(JSON.stringify(window.sessionStorage)).not.toMatch(/definition|description|payload/);
});
it('offers saved drafts only to authorized editors and starts publication readers at an exact snapshot', () => {
  const fixture = galleryFixture('event');
  const template = WorkTemplateOut.parse({
    id: source.workTypeId,
    organizationId: source.organizationId,
    targetType: 'project',
    status: 'published',
    scope: 'organization',
    ownerActorId: null,
    teamId: null,
    isBase: false,
    revision: 2,
    definition: fixture.definition,
    offeredTeamIds: [],
    canEdit: false,
    createdAt: '2026-10-25T12:00:00.000Z',
    updatedAt: '2026-10-25T12:00:00.000Z',
    latestVersion: {
      id: fixture.identity.catalogVersionId,
      organizationId: source.organizationId,
      workTypeId: source.workTypeId,
      number: 3,
      definition: fixture.definition,
      publishedAt: '2026-10-25T12:00:00.000Z',
      publishedByActorId: null,
    },
  });
  const reader = sourceCopyChoices(template);
  expect(reader).toHaveLength(1);
  expect(
    sourceCopyChoices({ ...template, draftDefinition: template.definition }).map(
      (choice) => choice.source.kind,
    ),
  ).toEqual(['publication', 'draft']);
  expect(reader[0]?.source).toMatchObject({
    kind: 'publication',
    selection: { kind: 'pinned', workTypeVersionId: template.latestVersion?.id },
  });
  expect(
    sourceCopyChoices({ ...template, canEdit: true }).map((choice) => choice.source.kind),
  ).toEqual(['draft', 'publication']);
  const readableDraft = {
    ...template,
    status: 'draft' as const,
    latestVersion: null,
    canEdit: false,
  };
  expect(sourceCopyChoices(readableDraft).map((choice) => choice.source.kind)).toEqual(['draft']);
});

it('treats unsupported catalog metadata as an unavailable saved-source flow', () => {
  const attempt = createSourceCopy(owner, source);
  const storageKey = Object.keys(window.sessionStorage)[0];
  if (!storageKey) throw new Error('Missing session key');
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ ...attempt, source: { kind: 'catalog', slug: 'event', release: 1 } }),
  );
  expect(readSourceCopy(owner, attempt.id)).toBeNull();
});
