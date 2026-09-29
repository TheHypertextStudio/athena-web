import '@testing-library/jest-dom/vitest';

import type { AgentSessionId, SessionActivityId } from '@docket/athena/ids';
import type { SessionActivityOut } from '@docket/athena/agent-contract';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThreadEntries } from '../../src/components/athena/thread-entries';
import type { ThreadEntry } from '../../src/lib/athena/job-presentation';

function actionActivity(overrides: Partial<SessionActivityOut> = {}): SessionActivityOut {
  return {
    id: 'activity_1' as SessionActivityId,
    sessionId: 'session_1' as AgentSessionId,
    organizationId: null,
    type: 'action',
    body: {
      action: { kind: 'update_task', summary: 'update the task', mode: 'proposal' },
    },
    createdAt: '2026-07-15T16:00:00.000Z',
    ...overrides,
  };
}

function entries(activities: readonly SessionActivityOut[]): readonly ThreadEntry[] {
  return activities.map((activity) => ({ kind: 'activity', at: activity.createdAt, activity }));
}

afterEach(() => {
  cleanup();
});

describe('ThreadEntries', () => {
  it('renders Athena reply Markdown as formatted prose', () => {
    render(
      <ThreadEntries
        entries={entries([
          actionActivity({
            type: 'response',
            body: { text: 'The answer is **20**.', author: 'athena' },
          }),
        ])}
        workspaceId="org_1"
        onWidgetMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('20')).toHaveProperty('tagName', 'STRONG');
    expect(screen.queryByText(/\*\*20\*\*/)).not.toBeInTheDocument();
  });

  it('keeps proposed actions in history with their review state and device return', () => {
    const { container } = render(
      <ThreadEntries
        entries={entries([
          actionActivity({
            approvalStatus: 'proposed',
            body: {
              lattice: { runtimeName: 'Mac Studio', outcome: 'completed' },
              action: { kind: 'comment', summary: 'Post result on task', mode: 'proposal' },
            },
          }),
        ])}
        workspaceId="org_1"
        onWidgetMessage={vi.fn()}
      />,
    );

    const action = container.querySelector<HTMLElement>('[data-slot="athena-action"]');
    expect(action).not.toBeNull();
    if (!action) throw new Error('missing action');
    expect(within(action).getByText('Needs review')).toBeVisible();
    expect(within(action).getByText('Post result on task')).toBeVisible();
    expect(within(action).getByText('Returned from Mac Studio')).toBeVisible();
  });

  it('shows an executed tool, its outcome state, time, and on-demand details', () => {
    render(
      <ThreadEntries
        entries={entries([
          actionActivity({
            body: {
              action: {
                kind: 'search',
                summary: 'searched tasks',
                mode: 'execute',
                toolCall: { connection: 'docket', tool: 'search', input: { query: 'budget' } },
                result: { content: 'Found 2 tasks', isError: false },
              },
            },
          }),
        ])}
        workspaceId="org_1"
        onWidgetMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Searched tasks')).toBeVisible();
    expect(screen.getByText('Done')).toBeVisible();
    expect(screen.getByText('Docket · search')).toBeVisible();
    expect(document.querySelector('time[datetime="2026-07-15T16:00:00.000Z"]')).toBeVisible();
    expect(screen.queryByText('Found 2 tasks')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Found 2 tasks')).toBeVisible();
    expect(screen.getByText('budget')).toBeVisible();
  });

  it('shows failure without rendering provider output', () => {
    render(
      <ThreadEntries
        entries={entries([
          actionActivity({
            approvalStatus: 'failed',
            body: {
              action: {
                summary: 'Looked up tasks',
                toolCall: { connection: 'docket', tool: 'search', input: { query: 'budget' } },
                result: { content: 'secret provider failure', isError: true },
              },
            },
          }),
        ])}
        workspaceId="org_1"
        onWidgetMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Failed')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.queryByText('secret provider failure')).not.toBeInTheDocument();
  });

  it('keeps provider error text out of the conversation', () => {
    const { container } = render(
      <ThreadEntries
        entries={entries([
          actionActivity({ type: 'error', body: { text: 'provider failure detail' } }),
        ])}
        workspaceId="org_1"
        onWidgetMessage={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
