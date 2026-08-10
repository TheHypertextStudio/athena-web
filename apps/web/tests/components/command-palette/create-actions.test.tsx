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

const { openCreate, routerPush, templates, contextState } = vi.hoisted(() => ({
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
          payload: {},
        },
      ],
    },
  },
  contextState: {
    density: 'comfortable' as const,
    setDensity: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('@docket/ui/components', () => ({
  DENSITIES: ['compact', 'comfortable', 'spacious'],
  useContextState: () => contextState,
}));

vi.mock('@docket/ui/hooks', () => ({
  useVocabulary: (kind: string) =>
    ({ task: 'Task', project: 'Project', initiative: 'Initiative', program: 'Program' })[kind] ??
    kind,
}));

vi.mock('../../../src/components/active-org', () => ({
  useActiveOrg: () => ({
    orgs: [{ id: 'org_alpha', name: 'Alpha', slug: 'alpha' }],
    activeOrgId: 'org_alpha',
    orgName: () => 'Alpha',
  }),
}));

vi.mock('../../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ request: null, openCreate, closeCreate: vi.fn() }),
}));

vi.mock('../../../src/components/templates/queries', () => ({
  sortTemplates: <Template,>(items: readonly Template[]) => [...items],
  templatesDef: () => ({}),
}));

vi.mock('../../../src/lib/query', () => ({
  useApiQuery: () => templates,
}));

import { useCommandActions } from '../../../src/components/command-palette/use-command-actions';

/** Supply the query client used by the command hook's sign-out action. */
function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  openCreate.mockReset();
  routerPush.mockReset();
});

describe('command palette create actions', () => {
  it.each([
    ['task', 'action:new:task'],
    ['project', 'action:new:project'],
    ['initiative', 'action:new:initiative'],
    ['program', 'action:new:program'],
  ] as const)('opens a workspace-scoped %s request directly', (kind, actionId) => {
    const close = vi.fn();
    const { result } = renderHook(() => useCommandActions({ scope: 'org', open: true, close }), {
      wrapper,
    });

    act(() => {
      result.current.find((item) => item.id === actionId)?.run();
    });

    expect(close).toHaveBeenCalledOnce();
    expect(openCreate).toHaveBeenCalledWith({
      kind,
      initialWorkspaceId: 'org_alpha',
      sameWorkspaceCompletion: 'open',
    });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('opens a template-backed request directly and auto-applies its template', () => {
    const close = vi.fn();
    const { result } = renderHook(() => useCommandActions({ scope: 'org', open: true, close }), {
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
});
