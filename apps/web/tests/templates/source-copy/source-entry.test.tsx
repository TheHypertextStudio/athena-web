import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TemplateCopyAction } from '@/components/templates/source-copy/template-copy-action';
import { readSourceCopy } from '@/components/templates/source-copy/source-copy-session';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { galleryFixture } from '../gallery/gallery-fixture';
const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'person' }, session: { id: 'session' } } }),
}));
vi.mock('@/lib/interactions/navigation', () => ({ useAppRouter: () => ({ push: mocks.push }) }));
function template(canEdit: boolean) {
  const source = galleryFixture('event');
  return WorkTemplateOut.parse({
    id: source.identity.workTypeId,
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    targetType: 'project',
    status: 'published',
    scope: 'organization',
    ownerActorId: null,
    teamId: null,
    isBase: false,
    revision: 1,
    definition: { ...source.definition, name: 'Saved event' },
    offeredTeamIds: [],
    canEdit,
    createdAt: '2026-10-25T12:00:00.000Z',
    updatedAt: '2026-10-25T12:00:00.000Z',
    latestVersion: {
      id: source.identity.catalogVersionId,
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      workTypeId: source.identity.workTypeId,
      number: 2,
      definition: source.definition,
      publishedAt: '2026-10-25T12:00:00.000Z',
      publishedByActorId: null,
    },
  });
}
beforeEach(() => {
  window.sessionStorage.clear();
  mocks.push.mockReset();
});
it.each([true, false])(
  'enters a focused route using only an authorized saved source for canEdit=%s',
  (canEdit) => {
    render(<TemplateCopyAction template={template(canEdit)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy to a workspace' }));
    const route = String(mocks.push.mock.calls[0]?.[0]);
    expect(route).toMatch(/\/work-templates\/copy\/[a-f0-9-]{36}$/);
    const flow = readSourceCopy(
      { userId: 'person', sessionId: 'session' },
      route.split('/').at(-1) ?? '',
    );
    expect(flow?.source.kind).toBe(canEdit ? 'draft' : 'publication');
    expect(route).not.toContain('?');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('Saved event');
  },
);
it('copies the explicitly selected immutable history version even when a draft is editable', () => {
  const value = template(true);
  if (!value.latestVersion) throw new Error('Missing snapshot');
  render(<TemplateCopyAction template={value} version={value.latestVersion} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy version 2' }));
  const route = String(mocks.push.mock.calls[0]?.[0]);
  expect(
    readSourceCopy({ userId: 'person', sessionId: 'session' }, route.split('/').at(-1) ?? '')
      ?.source,
  ).toMatchObject({
    kind: 'publication',
    selection: { kind: 'pinned', workTypeVersionId: value.latestVersion.id },
  });
});
