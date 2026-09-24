import '@testing-library/jest-dom/vitest';

import type { AgentSessionId, SessionActivityId } from '@docket/athena/ids';
import type { SessionActivityOut } from '@docket/athena/agent-contract';
import { cleanup, render, screen } from '@testing-library/react';
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

  it('renders no chip for a proposal-mode action — the proposal card is its record', () => {
    const { container } = render(
      <ThreadEntries
        entries={entries([actionActivity()])}
        workspaceId="org_1"
        onWidgetMessage={vi.fn()}
      />,
    );

    expect(screen.queryByText('Update the task')).not.toBeInTheDocument();
    expect(screen.queryByText('update the task')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a capitalized chip for a non-proposal action', () => {
    render(
      <ThreadEntries
        entries={entries([
          actionActivity({
            body: { action: { kind: 'search', summary: 'searched tasks', mode: 'suggestion' } },
          }),
        ])}
        workspaceId="org_1"
        onWidgetMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Searched tasks')).toBeVisible();
  });
});
