import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContextProvider } from '@docket/ui/components';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { SourceCopyFlow } from '@/components/templates/source-copy/source-copy-flow';
import { SourceCopyWorkspace } from '@/components/templates/source-copy/source-copy-workspace';
import {
  createSourceCopy,
  writeSourceCopy,
  sourceCopyChoices,
} from '@/components/templates/source-copy/source-copy-session';
import { sourceCopyAttempt } from '@/components/templates/source-copy/source-copy-attempt';
import { retainGalleryOriginal } from '@/components/templates/gallery/gallery-acceptance-attempt';
import { galleryFixture, galleryPreview } from '../gallery/gallery-fixture';
import { WorkTemplateSourceCopyPreview } from '@docket/work/template-copy';
import { OrganizationId } from '@docket/identity-access/ids';
import { deferred } from '../../support/deferred';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  preview: vi.fn(),
  reads: vi.fn(),
  labelReads: vi.fn(),
  labelName: 'Volunteer planning',
  template: null as WorkTemplateOut | null,
  allowed: true,
  sessionId: 'actual-session',
}));
vi.mock('@/components/docket-link', () => ({
  default: ({
    navigation: _navigation,
    ...props
  }: ComponentProps<'a'> & { navigation?: string }) => <a {...props} />,
}));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'person' }, session: { id: mocks.sessionId } } }),
}));
vi.mock('@/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({ orgs: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Destination' }] }),
  useOptionalActiveOrg: () => ({ orgs: [] }),
}));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({
    canContribute: mocks.allowed,
    canManage: mocks.allowed,
    loading: false,
  }),
}));
vi.mock('@/components/templates/work-template-source-copy-queries', () => ({
  useTemplateSourceCopyPreview: () => ({ mutateAsync: mocks.preview }),
  useTemplateSourceCopyAccept: () => ({ mutateAsync: vi.fn() }),
  templateSourceCopyStatusDef: (orgId: string, requestId: string) => ({
    queryKey: [orgId, requestId],
    queryFn: mocks.lookup,
  }),
}));
vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApiQuery: (definition: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    if (definition.queryKey.includes('labels')) {
      mocks.labelReads(definition.queryKey);
      return {
        data: {
          items: mocks.labelName
            ? [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FB0', name: mocks.labelName }]
            : [],
        },
        isPending: false,
        isFetching: false,
        isError: false,
      };
    }
    const source = definition.queryKey.includes('definition');
    if (source) mocks.reads(definition.enabled);
    const data = source ? mocks.template : { workTemplateAuthoring: 'contributors' };
    return {
      data: definition.enabled ? data : undefined,
      isPending: !definition.enabled,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));
const owner = { userId: 'person', sessionId: 'actual-session' };
const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const receipt = WorkTemplateCopyReceipt.parse({
  bundleId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  changeSetId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  mode: 'private_drafts',
  state: 'installed',
  roots: [
    { workTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAY', workTypeVersionId: null, targetType: 'project' },
  ],
});
function fixture() {
  const source = galleryFixture('event');
  return WorkTemplateOut.parse({
    id: source.identity.workTypeId,
    organizationId: orgId,
    targetType: 'project',
    status: 'draft',
    scope: 'personal',
    ownerActorId: null,
    teamId: null,
    isBase: false,
    revision: 1,
    definition: { ...source.definition, name: 'Saved event' },
    offeredTeamIds: [],
    latestVersion: null,
    canEdit: true,
    createdAt: '2026-10-25T12:00:00.000Z',
    updatedAt: '2026-10-25T12:00:00.000Z',
  });
}
function start() {
  const template = fixture();
  const source = sourceCopyChoices(template)[0]?.source;
  if (!source) throw new Error('Missing saved source');
  mocks.template = template;
  return { ...createSourceCopy(owner, source), destinationOrgId: template.organizationId };
}
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
beforeEach(() => {
  window.sessionStorage.clear();
  mocks.reads.mockReset();
  mocks.labelReads.mockReset();
  mocks.labelName = 'Volunteer planning';
  mocks.preview.mockReset();
  mocks.lookup.mockReset();
  mocks.allowed = true;
  mocks.sessionId = owner.sessionId;
});
afterEach(cleanup);
it('reconciles the original actual receipt before enabling any saved source read', async () => {
  const waiting = deferred<WorkTemplateCopyReceipt>();
  mocks.lookup.mockReturnValue(waiting.promise);
  const memory = { ...start(), submitted: true, phase: 'review' as const };
  const request = { roots: [memory.source], mode: memory.mode, labels: [], offerings: [] };
  const attempt = await sourceCopyAttempt({ ...owner, orgId, attemptId: memory.id }, request, {
    mode: memory.mode,
    reviewFingerprint: `sha256:${'a'.repeat(64)}`,
  });
  retainGalleryOriginal({ ...owner, orgId, attemptId: memory.id }, attempt);
  render(
    <ContextProvider>
      <QueryClientProvider client={client()}>
        <SourceCopyFlow owner={owner} memory={memory} orgId={orgId} onChange={() => true} />
      </QueryClientProvider>
    </ContextProvider>,
  );
  await screen.findByText('Checking whether your templates were saved…');
  expect(mocks.reads.mock.calls.some(([enabled]) => enabled)).toBe(false);
  await act(async () => {
    waiting.resolve(receipt);
  });
  await screen.findByRole('heading', { name: 'Private drafts kept' });
  expect(mocks.reads.mock.calls.some(([enabled]) => enabled)).toBe(false);
  expect(mocks.preview).not.toHaveBeenCalled();
});
it('returns a restored review to an honest destination refusal when authoring permission is gone', async () => {
  const memory = { ...start(), phase: 'review' as const };
  mocks.allowed = false;
  render(
    <ContextProvider>
      <QueryClientProvider client={client()}>
        <SourceCopyFlow owner={owner} memory={memory} orgId={orgId} onChange={() => true} />
      </QueryClientProvider>
    </ContextProvider>,
  );
  await screen.findByText('You do not have permission to add templates here.');
  expect(screen.getByRole('button', { name: 'Review copy' })).toBeDisabled();
  expect(mocks.preview).not.toHaveBeenCalled();
});
it('does not expose the saved source choices when the actual authenticated session changes', async () => {
  const memory = start();
  writeSourceCopy(owner, memory);
  const view = render(
    <ContextProvider>
      <QueryClientProvider client={client()}>
        <SourceCopyWorkspace orgId={orgId} attemptId={memory.id} />
      </QueryClientProvider>
    </ContextProvider>,
  );
  await screen.findByText('Saved event');
  expect(screen.queryByRole('combobox', { name: 'Copy from' })).not.toBeInTheDocument();
  expect(screen.getByText('Saved draft')).toBeVisible();
  mocks.sessionId = 'another-session';
  view.rerender(
    <ContextProvider>
      <QueryClientProvider client={client()}>
        <SourceCopyWorkspace orgId={orgId} attemptId={memory.id} />
      </QueryClientProvider>
    </ContextProvider>,
  );
  await screen.findByRole('heading', { name: 'This copy is not available in this tab' });
  await waitFor(() => {
    expect(screen.queryByText('Saved event')).not.toBeInTheDocument();
  });
});

it.each([true, false])(
  'shows checked omissions before Keep without exposing source IDs when names exist=%s',
  async (nameAvailable) => {
    const memory = {
      ...start(),
      destinationOrgId: OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1'),
      phase: 'review' as const,
    };
    if (memory.source.kind !== 'draft') throw new Error('Expected saved draft');
    const source = {
      ...memory.source,
      draftRevision: 1,
      draftFingerprint: `sha256:${'a'.repeat(64)}`,
    };
    const catalog = galleryPreview();
    const labelId = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
    mocks.labelName = nameAvailable ? 'Volunteer planning' : '';
    mocks.preview.mockResolvedValue(
      WorkTemplateSourceCopyPreview.parse({
        ...catalog,
        roots: [source],
        copies: catalog.copies.map((copy, index) => ({
          ...copy,
          source: index === 0 ? source : copy.source,
          referenceBindings:
            index === 0
              ? [
                  {
                    slot: { kind: 'blueprint_step', key: copy.definition.blueprint.steps[0]?.key },
                    target: catalog.copies[1]?.source,
                  },
                ]
              : [],
        })),
        omissions: [
          {
            source,
            kind: 'label',
            path: ['blueprint', 'steps', 0, 'fields', 'labelIds'],
            count: 1,
            value: labelId,
          },
        ],
      }),
    );
    render(
      <ContextProvider>
        <QueryClientProvider client={client()}>
          <SourceCopyFlow
            owner={owner}
            memory={memory}
            orgId={memory.destinationOrgId}
            onChange={() => true}
          />
        </QueryClientProvider>
      </ContextProvider>,
    );
    const adjustments = await screen.findByRole('region', { name: 'Copy adjustments' });
    expect(adjustments).toHaveTextContent('Labels will be left out');
    if (nameAvailable) expect(adjustments).toHaveTextContent('Volunteer planning');
    expect(adjustments).not.toHaveTextContent(labelId);
    expect(screen.getByRole('button', { name: 'Keep private drafts' })).toBeEnabled();
    expect(mocks.labelReads.mock.calls[0]?.[0]).toContain(memory.source.organizationId);
    expect(mocks.labelReads.mock.calls[0]?.[0]).not.toContain(memory.destinationOrgId);
    expect(screen.getByText('1 change to review')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `Inspect ${catalog.copies[0]?.name}` }));
    const changeHeadings = screen.getAllByRole('heading', { name: /changes in this copy/i });
    expect(changeHeadings).toHaveLength(1);
    expect(changeHeadings[0]).toBeVisible();
    expect(screen.queryByText('Optional adjustments', { exact: true })).not.toBeInTheDocument();
  },
);

it.each(['choices', 'review'] as const)(
  'offers useful recovery when the saved source was archived during %s',
  async (phase) => {
    const memory = { ...start(), phase };
    if (!mocks.template) throw new Error('Missing saved source');
    mocks.template = { ...mocks.template, status: 'archived' };
    render(
      <ContextProvider>
        <QueryClientProvider client={client()}>
          <SourceCopyFlow owner={owner} memory={memory} orgId={orgId} onChange={() => true} />
        </QueryClientProvider>
      </ContextProvider>,
    );
    await screen.findByText('This saved template is no longer available to copy.');
    expect(screen.getByRole('link', { name: 'View work templates' })).toHaveAttribute(
      'href',
      `/orgs/${orgId}/work-templates`,
    );
    expect(screen.queryByRole('button', { name: 'Review copy' })).not.toBeInTheDocument();
    expect(mocks.preview).not.toHaveBeenCalled();
  },
);

it('announces pending copy review with useful status while preserving the way back', async () => {
  const waiting = deferred<WorkTemplateSourceCopyPreview>();
  const memory = { ...start(), phase: 'review' as const };
  mocks.preview.mockReturnValue(waiting.promise);
  render(
    <ContextProvider>
      <QueryClientProvider client={client()}>
        <SourceCopyFlow owner={owner} memory={memory} orgId={orgId} onChange={() => true} />
      </QueryClientProvider>
    </ContextProvider>,
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Checking the templates…');
  expect(screen.getByRole('button', { name: 'Back to choices' })).toBeEnabled();
});

it('offers review retry without repeating the same failure sentence', async () => {
  const memory = { ...start(), phase: 'review' as const };
  mocks.preview.mockRejectedValue(new Error('Private transport diagnostic'));
  render(
    <ContextProvider>
      <QueryClientProvider client={client()}>
        <SourceCopyFlow owner={owner} memory={memory} orgId={orgId} onChange={() => true} />
      </QueryClientProvider>
    </ContextProvider>,
  );
  await screen.findByRole('button', { name: 'Review again' });
  expect(screen.getAllByText(/Could not review this copy\.?/)).toHaveLength(1);
  expect(screen.queryByText('Private transport diagnostic')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back to choices' })).toBeEnabled();
});
