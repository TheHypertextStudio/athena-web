import type * as NavigationModule from '@/lib/interactions/navigation';
import type { PlanDraftOut } from '@docket/work/plan-draft-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { openAthena, replace, provideRailContent } = vi.hoisted(() => ({
  openAthena: vi.fn(),
  replace: vi.fn(),
  provideRailContent: vi.fn(() => () => undefined),
}));
vi.mock('@/lib/interactions/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof NavigationModule>()),
  useAppRouter: () => ({ replace }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock('../../src/components/athena/athena-conversation', () => ({
  default: ({ draftRequest }: { draftRequest: { text: string } | null }) => (
    <div data-testid="conversation">{draftRequest?.text ?? ''}</div>
  ),
}));
vi.mock('../../src/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({
    openAthena,
    provideRailContent,
    launchDraft: { text: 'Help me plan "Q3". ', version: 1 },
  }),
}));

import {
  PlanRailConversation,
  usePlanAthena,
} from '../../src/components/plan-canvas/plan-conversation';

describe('PlanRailConversation', () => {
  it('carries the mark, a way to the full page, and the thread seeded with the launch draft', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PlanRailConversation orgId="org_1" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'Open the Athena page' })).toHaveAttribute(
      'href',
      expect.stringContaining('org_1'),
    );
    expect(screen.getByTestId('conversation')).toHaveTextContent('Help me plan "Q3".');
  });
});

const plan = {
  id: 'plan_1',
  organizationId: 'org_1' as PlanDraftOut['organizationId'],
  rootInitiativeId: 'initiative_1' as PlanDraftOut['rootInitiativeId'],
  sessionId: null,
  title: 'Q3',
  status: 'active',
  revision: 1,
  document: { nodes: [], edges: [] },
  objects: {},
  createdAt: '',
  updatedAt: '',
} satisfies Parameters<typeof usePlanAthena>[2];
function Launch({ start }: { start: boolean }) {
  usePlanAthena('org_1', 'plan_1', plan, start);
  return <p>Plan board</p>;
}
it('does not open Athena on ordinary arrival at any screen width', () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
  render(<Launch start={false} />);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  expect(openAthena).not.toHaveBeenCalled();
});
it('honors explicit Plan with Athena entry and removes only its handled launch flag', () => {
  render(<Launch start />);
  expect(openAthena).toHaveBeenCalledWith(
    {
      workspaceId: 'org_1',
      source: { type: 'initiative', id: 'initiative_1', label: 'Q3' },
    },
    'Help me plan "Q3". ',
  );
  expect(replace).toHaveBeenCalledWith('/orgs/org_1/plans/plan_1');
});
