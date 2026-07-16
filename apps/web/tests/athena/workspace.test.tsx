import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AthenaWorkspace,
  effectiveAthenaSelectedId,
} from '../../src/components/athena/athena-workspace';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';
import type { PersonalAthenaSessionDetail } from '../../src/lib/athena/presentation';
import { okResponse, problemResponse } from '../support/query';

const needs: PersonalAthenaSessionDetail = {
  id: 'needs',
  objective: 'Approve a private calendar change',
  status: 'awaiting_approval',
  queueState: 'needs_you',
  workspace: { id: 'workspace_1', name: 'Hypertext Studio' },
  createdAt: '2026-07-15T15:00:00.000Z',
  updatedAt: '2026-07-15T16:00:00.000Z',
  activities: [],
};
const working: PersonalAthenaSessionDetail = {
  ...needs,
  id: 'working',
  objective: 'Prepare the launch review',
  status: 'running',
  queueState: 'working',
};

function transport(): PersonalAthenaTransport {
  return {
    pulse: vi.fn().mockResolvedValue(okResponse({ needsYou: 1, working: 1 })),
    queue: vi.fn().mockResolvedValue(
      okResponse({
        counts: { needsYou: 1, working: 1, finished: 0 },
        currentChat: working,
        sessions: { needsYou: [needs], working: [working], finished: [] },
      }),
    ),
    detail: vi.fn((id: string) => Promise.resolve(okResponse(id === 'working' ? working : needs))),
    message: vi.fn().mockResolvedValue(okResponse(working)),
    create: vi.fn().mockResolvedValue(okResponse(working)),
    decide: vi.fn().mockResolvedValue(okResponse(needs)),
    lifecycle: vi.fn().mockResolvedValue(okResponse(working)),
  };
}

describe('AthenaWorkspace', () => {
  it('derives a visible selection before effects can synchronize state', () => {
    expect(effectiveAthenaSelectedId('workspace-a-session', null, [working])).toBe(working.id);
    expect(effectiveAthenaSelectedId('workspace-a-session', null, [])).toBe('');
  });

  it('composes the dense cross-workspace queue and selected workbench', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={transport()} initialSessionId="working" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Your Athena work' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Needs you' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Working' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Prepare the launch review' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Approve a private calendar change/ }));
    expect(
      await screen.findByRole('heading', { name: 'Approve a private calendar change' }),
    ).toBeVisible();
  });

  it('turns an empty personal queue into a useful start-work state', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const create = vi.mocked(api.create);
    vi.mocked(api.queue).mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 0, finished: 0 },
        currentChat: null,
        sessions: { needsYou: [], working: [], finished: [] },
      }),
    );
    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'What should Athena move forward?' }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Athena objective'), {
      target: { value: 'Prepare tomorrow morning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({ prompt: 'Prepare tomorrow morning' });
    });
  });

  it('uses loaded context labels instead of calling focused work cross-workspace', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const contextual: PersonalAthenaSessionDetail = {
      ...working,
      workspace: null,
      context: {
        workspaceId: 'workspace_1',
        workspaceName: 'Hypertext Studio',
        source: { type: 'project', id: 'project_1', label: 'Athena launch' },
      },
    };
    vi.mocked(api.queue).mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 1, finished: 0 },
        currentChat: contextual,
        sessions: { needsYou: [], working: [contextual], finished: [] },
      }),
    );
    vi.mocked(api.detail).mockResolvedValue(okResponse(contextual));

    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} initialSessionId={contextual.id} />
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText('Hypertext Studio')).not.toHaveLength(0);
    expect(await screen.findAllByText('Athena launch')).not.toHaveLength(0);
    expect(screen.queryByText('Across workspaces')).not.toBeInTheDocument();
  });

  it('routes an optionless question answer through its owning session and activity', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const decide = vi.mocked(api.decide);
    const question: PersonalAthenaSessionDetail = {
      ...needs,
      status: 'awaiting_input',
      decision: {
        kind: 'question',
        id: 'elicitation_1',
        title: 'Which task?',
        private: true,
        options: [],
      },
    };
    vi.mocked(api.queue).mockResolvedValue(
      okResponse({
        counts: { needsYou: 1, working: 0, finished: 0 },
        currentChat: null,
        sessions: { needsYou: [question], working: [], finished: [] },
      }),
    );
    vi.mocked(api.detail).mockResolvedValue(okResponse(question));
    decide.mockResolvedValue(okResponse(question));

    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} initialSessionId={question.id} />
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: 'Answer Athena' }), {
      target: { value: 'The launch checklist' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Answer Athena' }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith('needs', 'elicitation_1', 'reply', {
        body: 'The launch checklist',
      });
    });
  });

  it('never selects a global or mismatched session outside a workspace filter', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const outside = { ...working, id: 'outside', workspace: { id: 'workspace_2', name: 'Other' } };
    vi.mocked(api.queue).mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 1, finished: 0 },
        currentChat: outside,
        sessions: { needsYou: [], working: [outside], finished: [] },
      }),
    );

    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} initialSessionId="outside" workspaceFilter="workspace_1" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'What should Athena move forward?' }),
    ).toBeVisible();
    expect(api.detail).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Athena objective'), {
      target: { value: 'Scoped work' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));
    await waitFor(() => {
      expect(api.create).toHaveBeenCalledWith({
        prompt: 'Scoped work',
        context: { workspaceId: 'workspace_1' },
      });
    });
  });

  it('contains selection synchronously when the workspace filter changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const workspaceA = {
      ...working,
      id: 'workspace-a-session',
      objective: 'Workspace A private objective',
      workspace: { id: 'workspace_a', name: 'Workspace A' },
    };
    const workspaceB = {
      ...working,
      id: 'workspace-b-session',
      objective: 'Workspace B private objective',
      workspace: { id: 'workspace_b', name: 'Workspace B' },
    };
    vi.mocked(api.queue).mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 2, finished: 0 },
        currentChat: workspaceA,
        sessions: { needsYou: [], working: [workspaceA, workspaceB], finished: [] },
      }),
    );
    vi.mocked(api.detail).mockImplementation((id) =>
      Promise.resolve(okResponse(id === workspaceA.id ? workspaceA : workspaceB)),
    );
    const view = render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} workspaceFilter="workspace_a" />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Workspace A private objective' }),
    ).toBeVisible();

    view.rerender(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} workspaceFilter="workspace_b" />
      </QueryClientProvider>,
    );

    expect(
      screen.queryByRole('heading', { name: 'Workspace A private objective' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Workspace B private objective' }),
    ).toBeVisible();
    expect(api.detail).toHaveBeenLastCalledWith(workspaceB.id);
  });

  it('announces application-owned mutation failures and clears feedback on retry success', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const api = transport();
    vi.mocked(api.create)
      .mockResolvedValueOnce(problemResponse('provider secret: sk-private', 500))
      .mockResolvedValueOnce(okResponse(working));
    vi.mocked(api.queue).mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 0, finished: 0 },
        currentChat: null,
        sessions: { needsYou: [], working: [], finished: [] },
      }),
    );
    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} />
      </QueryClientProvider>,
    );

    const objective = await screen.findByLabelText('Athena objective');
    fireEvent.change(objective, { target: { value: 'Prepare the review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Athena could not start this work.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('sk-private');

    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
