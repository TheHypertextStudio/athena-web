import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import type * as QueryModule from '@/lib/query';
const mocks = vi.hoisted(() => ({
  draft: vi.fn(),
  publish: vi.fn(),
  owner: 0,
  sessionPending: false,
}));
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
export const nestedId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
export const versionId = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
export function template(targetType: 'project' | 'task' | 'initiative' | 'program' = 'project') {
  return WorkTemplateOut.parse({
    id,
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    targetType,
    status: 'draft',
    scope: 'personal',
    ownerActorId: null,
    teamId: null,
    isBase: false,
    revision: 3,
    definition: {
      name: 'Community dinner',
      payload: { targetType, description: '## Preparation' },
    },
    offeredTeamIds: [],
    latestVersion: null,
    canEdit: true,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
  });
}
const nested = {
  ...template('task'),
  id: nestedId,
  status: 'published',
  scope: 'organization',
  definition: { ...template('task').definition, name: 'Vendor booking' },
  latestVersion: { id: versionId, number: 2 },
};
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    isPending: mocks.sessionPending,
    data: mocks.sessionPending
      ? null
      : { user: { id: String(mocks.owner) }, session: { id: String(mocks.owner) } },
  }),
}));
vi.mock('@/lib/query', async (original) => ({
  ...(await original<typeof QueryModule>()),
  useApiQuery: (definition: { reviewKind?: string; enabled?: boolean }) => ({
    data:
      definition.enabled === false
        ? undefined
        : {
            items: definition.reviewKind === 'versions' ? [{ id: versionId, number: 2 }] : [nested],
          },
    isError: false,
    isPending: false,
  }),
}));
vi.mock('@/components/templates/work-template-queries', () => ({
  workTemplateDef: () => ({}),
  workTemplateVersionsDef: () => ({ reviewKind: 'versions' }),
  workTemplatesDef: () => ({ reviewKind: 'catalog' }),
  useWorkTemplateWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    draft: { mutateAsync: mocks.draft, isPending: false },
    publish: { mutateAsync: mocks.publish, isPending: false },
    archive: { isPending: false },
  }),
}));
vi.mock('@/lib/app-location', async (original) => ({
  ...(await original()),
  useAppSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/interactions/navigation', async (original) => ({
  ...(await original()),
  useAppRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: true }),
}));
vi.mock('@/components/pickers/use-composer-options', () => ({
  useComposerOptions: () => ({ teamOptions: [], labelOptions: [], loading: false }),
}));
vi.mock('@/components/statuses/status-registry', () => ({
  useStatusRegistry: () => ({ statusesFor: () => [{ key: 'backlog', name: 'Backlog' }] }),
}));
vi.mock('@/components/templates/work-template-glyph-field', () => ({
  WorkTemplateGlyphField: () => null,
}));
vi.mock('@/components/editor/freeform-text', () => ({
  FreeformTextEditor: ({
    value,
    onChange,
    ariaLabel,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    disabled: boolean;
  }) => (
    <textarea
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.owner += 1;
  mocks.sessionPending = false;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
export function change(label: string, value: string, scope: HTMLElement = document.body): void {
  if (!within(scope).queryByLabelText(label)) {
    const disclosure =
      label === 'Starting summary'
        ? 'Add a starting summary'
        : label.startsWith('Starting ')
          ? 'Starting properties'
          : /^(Due|Start|Target) /.test(label)
            ? 'Dates'
            : /^(Nested template|Template version|Pinned version|Child parent)$/.test(label)
              ? 'Template and placement'
              : 'Responsibility';
    fireEvent.click(within(scope).getByRole('button', { name: disclosure }));
  }
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}
export function add(kind: string): HTMLElement {
  fireEvent.click(screen.getByRole('tab', { name: 'Work' }));
  const button = screen.getAllByRole('button', { name: `Add ${kind}` }).at(0);
  if (!button) throw new Error('Missing root add action');
  fireEvent.click(button);
  const child = screen.getAllByRole('group', { name: /Child work:/ }).at(-1);
  if (!child) throw new Error('Missing added child');
  return child;
}

export { mocks };
