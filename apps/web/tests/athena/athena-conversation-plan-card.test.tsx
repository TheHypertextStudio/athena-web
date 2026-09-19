import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet, elicitationsGet, presencePost, planGet } = vi.hoisted(() => ({
  chatGet: vi.fn(),
  planGet: vi.fn(),
  elicitationsGet: vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }),
  presencePost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          sessions: { chat: { $get: chatGet, messages: { $post: vi.fn() } } },
        },
      },
      me: {
        elicitations: { $get: elicitationsGet, presence: { $post: presencePost } },
        plans: { ':id': { $get: planGet } },
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
import { planStateLine } from '../../src/components/athena/thread-plan-entry';
import type { PlanStartSummary } from '../../src/components/plan-canvas/plan-start-card';
import type { PlanDraftOut, PlanNode } from '@docket/work/plan-draft-contract';
import { OrganizationId } from '@docket/identity-access/ids';

/** What the tool reported when the plan opened. */
function summary(): PlanStartSummary {
  return {
    planId: 'plan_1',
    href: '/orgs/org_1/plans/plan_1',
    title: 'Spring campaign',
    counts: { projects: 0, tasks: 0, draft: 0 },
  };
}

/** The plan as it stands now: two nodes, one of them confirmed. */
function livePlan(): PlanDraftOut {
  const node = (ref: string, status: 'draft' | 'confirmed'): PlanNode => ({
    ref,
    kind: 'task',
    parentRef: null,
    initiativeRefs: [],
    initiativeIds: [],
    fields: { title: ref },
    templateId: null,
    status,
    objectId: status === 'confirmed' ? `task_${ref}` : null,
  });
  return {
    id: 'plan_1',
    organizationId: OrganizationId.parse('01JQ0000000000000000000000'),
    sessionId: null,
    rootInitiativeId: null,
    title: 'Spring campaign',
    status: 'active',
    revision: 2,
    document: { nodes: [node('a', 'confirmed'), node('b', 'draft')], edges: [] },
    objects: {
      a: {
        name: 'a',
        statusName: null,
        health: null,
        href: '/orgs/org_1/tasks/a',
        archived: false,
      },
    },
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:05:00.000Z',
  };
}

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
  it('renders a plan_start action as one flat entry with the plan’s live state', async () => {
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
    planGet.mockResolvedValue(okResponse(livePlan()));
    mount();
    const entry = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-slot="athena-plan-entry"]');
      if (!found) throw new Error('plan entry not rendered yet');
      return found;
    });
    expect(within(entry).getByRole('link')).toHaveAttribute('href', '/orgs/org_1/plans/plan_1');
    // A flat entry: no nested card and no chip naming the same call above it.
    expect(screen.queryByText('Opened a plan')).toBeNull();
    const state = entry.querySelector('[data-slot="athena-plan-state"]');
    await waitFor(() => {
      expect(state).toHaveTextContent(planStateLine(livePlan(), summary()));
    });
  });

  it('shows only the chip when the tool failed or returned nothing usable', async () => {
    chatGet.mockResolvedValue(
      okResponse(thread([planStartActivity('Could not open a plan.', true)])),
    );
    mount();
    expect(await screen.findByText('Opened a plan')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="athena-plan-entry"]')).toBeNull();
  });
});
