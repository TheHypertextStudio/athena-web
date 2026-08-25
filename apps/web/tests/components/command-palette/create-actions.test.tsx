/**
 * Global creation commands opened from the command palette.
 *
 * @remarks
 * Creation is an effect in the persistent app shell, not a navigation to a list page with a
 * transient query parameter. These tests keep that distinction observable: running a command
 * closes the palette and sends a fully-scoped request to the global provider without pushing a
 * route. Template commands carry the template id in the same request so it is applied on open.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openCreate, routerPush, templates, members } = vi.hoisted(() => ({
  openCreate: vi.fn(),
  routerPush: vi.fn(),
  templates: {
    data: {
      items: [
        {
          id: 'template_bug',
          organizationId: 'org_alpha',
          name: 'Bug report',
          targetType: 'task',
          scope: 'organization',
          ownerActorId: null,
          teamId: null,
          payload: {},
        },
        {
          id: 'template_personal_mine',
          organizationId: 'org_alpha',
          name: 'My private template',
          targetType: 'task',
          scope: 'personal',
          ownerActorId: 'actor_self',
          teamId: null,
          payload: {},
        },
        {
          id: 'template_personal_other',
          organizationId: 'org_alpha',
          name: 'Someone else private',
          targetType: 'task',
          scope: 'personal',
          ownerActorId: 'actor_other',
          teamId: null,
          payload: {},
        },
        {
          id: 'template_team_default',
          organizationId: 'org_alpha',
          name: 'Default team template',
          targetType: 'task',
          scope: 'team',
          ownerActorId: null,
          teamId: 'team_default',
          payload: {},
        },
        {
          id: 'template_team_other',
          organizationId: 'org_alpha',
          name: 'Other team template',
          targetType: 'task',
          scope: 'team',
          ownerActorId: null,
          teamId: 'team_other',
          payload: {},
        },
      ],
    },
  },
  members: {
    data: { items: [{ userId: 'user_self', actorId: 'actor_self' }] },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('../../../src/components/active-org', () => ({
  useActiveOrg: () => ({
    orgs: [{ id: 'org_alpha', name: 'Alpha', slug: 'alpha' }],
    activeOrgId: 'org_alpha',
    defaultTeamId: 'team_default',
    orgName: () => 'Alpha',
  }),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'user_self' } } }) },
}));

vi.mock('../../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ request: null, openCreate, closeCreate: vi.fn() }),
}));

vi.mock('../../../src/components/templates/queries', () => ({
  sortTemplates: <Template,>(items: readonly Template[]) => [...items],
  templateMatchesContext: (
    template: { scope: string; ownerActorId: string | null; teamId: string | null },
    currentActorId: string | null,
    teamId: string | null,
  ) =>
    template.scope === 'organization' ||
    (template.scope === 'personal'
      ? template.ownerActorId === currentActorId
      : template.teamId === teamId),
  templatesDef: () => ({}),
}));

vi.mock('../../../src/lib/query', () => ({
  useApiQuery: () => templates,
  useApiListQuery: () => members,
  apiQueryOptions: () => ({}),
  queryKeys: { members: () => ['members'] },
  STALE: { static: Infinity },
}));

import { useCommandActions } from '../../../src/components/command-palette/use-command-actions';

/** Supply the query runtime used by the dynamic template reads. */
function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  openCreate.mockReset();
  routerPush.mockReset();
});

describe('command palette create actions', () => {
  it('opens a template-backed request directly and auto-applies its template', () => {
    const close = vi.fn();
    const { result } = renderHook(() => useCommandActions({ open: true, close }), {
      wrapper,
    });

    act(() => {
      result.current.find((item) => item.id === 'template:template_bug')?.run();
    });

    expect(close).toHaveBeenCalledOnce();
    expect(openCreate).toHaveBeenCalledWith({
      kind: 'task',
      initialWorkspaceId: 'org_alpha',
      sameWorkspaceCompletion: 'open',
      defaultTemplateId: 'template_bug',
    });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('exposes only workspace, current-person, and default-team templates', () => {
    const { result } = renderHook(() => useCommandActions({ open: true, close: vi.fn() }), {
      wrapper,
    });
    const ids = result.current.map((item) => item.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'template:template_bug',
        'template:template_personal_mine',
        'template:template_team_default',
      ]),
    );
    expect(ids).not.toContain('template:template_personal_other');
    expect(ids).not.toContain('template:template_team_other');
  });
});
