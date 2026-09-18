import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet, personalPost, pulseGet } = vi.hoisted(() => ({
  chatGet: vi.fn(),
  personalPost: vi.fn(),
  pulseGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: chatGet } } } },
      me: { athena: { chat: { messages: { $post: personalPost } }, pulse: { $get: pulseGet } } },
    },
  },
}));

import { AthenaRailConversation } from '../../src/components/athena/athena-rail-conversation';
import { AthenaPanelProvider } from '../../src/components/athena/athena-panel-provider';
import { PageContextProvider, PageSource } from '../../src/components/athena/page-context';

// jsdom has no scrollIntoView; the conversation pins the latest turn with it on every append.
Element.prototype.scrollIntoView = vi.fn();

const ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

function thread() {
  return {
    id: 'chat_1',
    kind: 'chat',
    status: 'completed',
    objective: 'Chat',
    startedAt: '2026-09-18T10:00:00.000Z',
    endedAt: null,
    createdAt: '2026-09-18T10:00:00.000Z',
    activities: [],
    result: null,
  };
}

afterEach(cleanup);

describe('AthenaRailConversation', () => {
  it('names itself, links to the wide view for the workspace, and shows the page chip', async () => {
    chatGet.mockResolvedValue(okResponse(thread()));
    pulseGet.mockResolvedValue(okResponse({ needsYou: 0, working: 0 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PageContextProvider workspace={{ workspaceId: ORG_ID, workspaceName: 'Harbor Health' }}>
          <PageSource type="project" id="project_1" label="Fall fundraiser launch" />
          <AthenaPanelProvider railVisible onRevealRail={vi.fn()}>
            <AthenaRailConversation orgId={ORG_ID} />
          </AthenaPanelProvider>
        </PageContextProvider>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: /Open the Athena page/ });
    expect(link).toHaveAttribute('href', `/athena?workspace=${ORG_ID}`);
    const form = await screen.findByRole('form', { name: /Message Athena/ });
    expect(within(form).getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();
  });
});
