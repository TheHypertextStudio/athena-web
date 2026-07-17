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
    activity: vi.fn().mockResolvedValue(okResponse({ items: [], nextCursor: undefined })),
    message: vi.fn().mockResolvedValue(okResponse(working)),
    create: vi.fn().mockResolvedValue(okResponse(working)),
    decide: vi.fn().mockResolvedValue(okResponse(needs)),
    lifecycle: vi.fn().mockResolvedValue(okResponse(working)),
  };
}

describe('AthenaWorkspace', () => {
  it('continues the Needs you lane without replacing its exact count', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const older = { ...needs, id: 'older-needs', objective: 'Answer an older private question' };
    vi.mocked(api.queue)
      .mockResolvedValueOnce(
        okResponse({
          counts: { needsYou: 2, working: 1, finished: 0 },
          currentChat: working,
          sessions: { needsYou: [needs], working: [working], finished: [] },
          nextCursors: { needsYou: 'needs-cursor' },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          counts: { needsYou: 2, working: 1, finished: 0 },
          currentChat: working,
          sessions: { needsYou: [older], working: [working], finished: [] },
        }),
      );

    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Show older Needs you' }));
    expect(await screen.findByText('Answer an older private question')).toBeVisible();
    expect(api.queue).toHaveBeenLastCalledWith({ needsYouCursor: 'needs-cursor' });
  });

  it.each([
    {
      label: 'Working',
      cursorKey: 'workingCursor' as const,
      responseCursor: 'working' as const,
      cursor: 'working-cursor',
      sessionKey: 'working' as const,
      older: {
        ...working,
        id: 'older-working',
        objective: 'Continue an older launch review',
      },
    },
    {
      label: 'Finished',
      cursorKey: 'finishedCursor' as const,
      responseCursor: 'finished' as const,
      cursor: 'finished-cursor',
      sessionKey: 'finished' as const,
      older: {
        ...working,
        id: 'older-finished',
        objective: 'Inspect an older completed review',
        status: 'completed' as const,
        queueState: 'finished' as const,
      },
    },
  ])('continues the $label lane with its own cursor', async (scenario) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    vi.mocked(api.queue)
      .mockResolvedValueOnce(
        okResponse({
          counts: { needsYou: 1, working: 2, finished: 1 },
          currentChat: working,
          sessions: { needsYou: [needs], working: [working], finished: [] },
          nextCursors: { [scenario.responseCursor]: scenario.cursor },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          counts: { needsYou: 1, working: 2, finished: 1 },
          currentChat: working,
          sessions: {
            needsYou: [],
            working: scenario.sessionKey === 'working' ? [scenario.older] : [],
            finished: scenario.sessionKey === 'finished' ? [scenario.older] : [],
          },
        }),
      );

    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: `Show older ${scenario.label}` }));
    expect(await screen.findByText(scenario.older.objective)).toBeVisible();
    expect(api.queue).toHaveBeenLastCalledWith({ [scenario.cursorKey]: scenario.cursor });
  });

  it('prepends an older activity window to the selected workbench', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    vi.mocked(api.detail).mockResolvedValue(
      okResponse({ ...working, activityNextCursor: 'activity-cursor' }),
    );
    vi.mocked(api.activity).mockResolvedValue(
      okResponse({
        items: [
          {
            id: 'older-message',
            type: 'message',
            createdAt: '2026-07-15T14:00:00.000Z',
            text: 'Earlier work context',
            author: 'athena',
          },
        ],
      }),
    );

    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} initialSessionId="working" />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Show older activity' }));
    expect(await screen.findByText('Earlier work context')).toBeVisible();
    expect(api.activity).toHaveBeenCalledWith('working', 'activity-cursor');
  });

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

  it('opens supplied source context as explicit new work instead of selecting queue history', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const context = {
      workspaceId: 'workspace_1',
      source: { type: 'project' as const, id: 'project_2', label: 'Contextual launch' },
    };
    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace
          transport={api}
          workspaceFilter="workspace_1"
          invocationContext={context}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'What should Athena move forward?' }),
    ).toBeVisible();
    expect(api.detail).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Athena objective'), {
      target: { value: 'Review this launch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));
    await waitFor(() => {
      expect(api.create).toHaveBeenCalledWith({ prompt: 'Review this launch', context });
    });
  });

  it('preserves workspace-only explicit new-work intent from dock expansion', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace
          transport={api}
          workspaceFilter="workspace_1"
          invocationContext={{ workspaceId: 'workspace_1' }}
          startNewWork
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'What should Athena move forward?' }),
    ).toBeVisible();
    expect(api.detail).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Athena objective'), {
      target: { value: 'Prepare this workspace review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));
    await waitFor(() => {
      expect(api.create).toHaveBeenCalledWith({
        prompt: 'Prepare this workspace review',
        context: { workspaceId: 'workspace_1' },
      });
    });
  });

  it('starts contextual new work instead of steering a canceled session', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const canceled: PersonalAthenaSessionDetail = {
      ...working,
      id: 'canceled',
      objective: 'Canceled project review',
      status: 'canceled',
      queueState: 'finished',
      context: {
        workspaceId: 'workspace_1',
        source: { type: 'project', id: 'project_canceled', label: 'Canceled launch' },
      },
    };
    vi.mocked(api.queue).mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 0, finished: 1 },
        currentChat: null,
        sessions: { needsYou: [], working: [], finished: [canceled] },
      }),
    );
    vi.mocked(api.detail).mockResolvedValue(okResponse(canceled));
    render(
      <QueryClientProvider client={client}>
        <AthenaWorkspace transport={api} initialSessionId={canceled.id} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start new work' }));
    expect(screen.queryByRole('form', { name: 'Steer Athena' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Athena objective'), {
      target: { value: 'Try the project review again' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));
    await waitFor(() => {
      expect(api.create).toHaveBeenCalledWith({
        prompt: 'Try the project review again',
        context: canceled.context,
      });
    });
    expect(api.message).not.toHaveBeenCalled();
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
