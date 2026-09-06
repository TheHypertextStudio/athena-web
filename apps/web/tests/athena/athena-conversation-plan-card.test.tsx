import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet } = vi.hoisted(() => ({ chatGet: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          sessions: { chat: { $get: chatGet, messages: { $post: vi.fn() } } },
        },
      },
    },
  },
}));

vi.mock('@/components/docket-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import AthenaConversation from '../../src/components/athena/athena-conversation';

Element.prototype.scrollIntoView = vi.fn();

function thread(activities: readonly Record<string, unknown>[]) {
  return {
    id: 'chat_session',
    kind: 'chat',
    status: 'completed',
    objective: 'Chat',
    startedAt: '2026-09-05T10:00:00.000Z',
    endedAt: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    activities,
    result: null,
  };
}

function planStartActivity(content: string, isError = false) {
  return {
    id: 'activity_plan_start',
    sessionId: 'chat_session',
    organizationId: null,
    type: 'action',
    body: {
      action: {
        kind: 'plan_start',
        summary: 'Opened a plan',
        result: { content, isError },
      },
    },
    createdAt: '2026-09-05T10:01:00.000Z',
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthenaConversation orgId="org_1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AthenaConversation plan card', () => {
  it('renders the plan card beneath the chip for a plan_start action', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          planStartActivity(
            JSON.stringify({
              planId: 'plan_1',
              href: '/orgs/org_1/plans/plan_1',
              title: 'Spring campaign',
              counts: { projects: 0, tasks: 0, draft: 0 },
            }),
          ),
        ]),
      ),
    );
    mount();
    const card = await screen.findByTestId('plan-start-card');
    expect(card.querySelector('a')).toHaveAttribute('href', '/orgs/org_1/plans/plan_1');
  });

  it('shows only the chip when the tool failed or returned nothing usable', async () => {
    chatGet.mockResolvedValue(
      okResponse(thread([planStartActivity('Could not open a plan.', true)])),
    );
    mount();
    expect(await screen.findByText('Opened a plan')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-start-card')).toBeNull();
  });
});
