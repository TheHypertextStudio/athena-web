import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AthenaWorkspace } from '../../src/components/athena/athena-workspace';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';
import type { PersonalAthenaSessionDetail } from '../../src/lib/athena/presentation';
import { okResponse } from '../support/query';

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
});
