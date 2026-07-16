import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  AthenaPanelProvider,
  useAthenaPanel,
} from '../../src/components/athena/athena-panel-provider';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';
import type { PersonalAthenaSessionDetail } from '../../src/lib/athena/presentation';
import { okResponse } from '../support/query';

const detail: PersonalAthenaSessionDetail = {
  id: 'session_needs',
  objective: 'Confirm the private launch review change',
  status: 'awaiting_approval',
  queueState: 'needs_you',
  workspace: { id: 'workspace_1', name: 'Hypertext Studio' },
  context: { workspaceId: 'workspace_1' },
  createdAt: '2026-07-15T15:00:00.000Z',
  updatedAt: '2026-07-15T16:00:00.000Z',
  activities: [],
  result: null,
};

function transport(): PersonalAthenaTransport {
  return {
    pulse: vi.fn().mockResolvedValue(okResponse({ needsYou: 1, working: 2 })),
    queue: vi.fn().mockResolvedValue(
      okResponse({
        counts: { needsYou: 1, working: 2, finished: 4 },
        currentChat: detail,
        sessions: { needsYou: [detail], working: [], finished: [] },
      }),
    ),
    detail: vi.fn().mockResolvedValue(okResponse(detail)),
    message: vi.fn().mockResolvedValue(okResponse(detail)),
    create: vi.fn().mockResolvedValue(okResponse(detail)),
    decide: vi.fn().mockResolvedValue(okResponse(detail)),
    lifecycle: vi.fn().mockResolvedValue(okResponse(detail)),
  };
}

function OpenButton(): ReactNode {
  const { openAthena } = useAthenaPanel();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          openAthena({
            workspaceId: 'workspace_1',
            source: { type: 'project', id: 'project_1', label: 'Athena launch' },
          });
        }}
      >
        Open contextual Athena
      </button>
      <button
        type="button"
        onClick={() => {
          openAthena({ workspaceId: 'workspace_1' }, 'Prepare the review');
        }}
      >
        Start contextual Athena
      </button>
    </>
  );
}

function renderPanel(api = transport(), showPulse = true): PersonalAthenaTransport {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AthenaPanelProvider transport={api} showPulse={showPulse}>
        <OpenButton />
      </AthenaPanelProvider>
    </QueryClientProvider>,
  );
  return api;
}

describe('AthenaPanelProvider', () => {
  it('loads only compact pulse counts until the dock is opened', async () => {
    const api = renderPanel();

    await waitFor(() => {
      expect(api.pulse).toHaveBeenCalled();
    });
    expect(api.queue).not.toHaveBeenCalled();
    expect(api.detail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open Athena' }));
    await waitFor(() => {
      expect(api.queue).toHaveBeenCalled();
      expect(api.detail).toHaveBeenCalledWith('session_needs');
    });
  });

  it('keeps the redundant pulse read out of the full personal workspace', async () => {
    const api = renderPanel(transport(), false);

    expect(screen.queryByRole('button', { name: 'Open Athena' })).not.toBeInTheDocument();
    await Promise.resolve();
    expect(api.pulse).not.toHaveBeenCalled();
  });

  it('opens the same personal Athena everywhere with Cmd/Ctrl+J, including without a workspace', async () => {
    renderPanel();

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(await screen.findByRole('dialog', { name: 'Athena' })).toBeVisible();
    expect(await screen.findByText('1 needs you')).toBeVisible();
    expect(screen.getByText('2 working')).toBeVisible();
    expect(await screen.findByText('Confirm the private launch review change')).toBeVisible();
  });

  it('ignores repeated shortcuts and shortcuts typed into editable controls', async () => {
    renderPanel();

    fireEvent.keyDown(document, { key: 'j', metaKey: true, repeat: true });
    expect(screen.queryByRole('dialog', { name: 'Athena' })).not.toBeInTheDocument();

    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'j', metaKey: true });
    expect(screen.queryByRole('dialog', { name: 'Athena' })).not.toBeInTheDocument();
    input.remove();
  });

  it('preserves invocation context when a surface opens the dock and expands it', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Open contextual Athena' }));

    expect(await screen.findByText('Athena launch')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open full Athena' })).toHaveAttribute(
        'href',
        '/athena?workspace=workspace_1&context=project%3Aproject_1&contextLabel=Athena+launch&session=session_needs',
      );
    });
  });

  it('tracks the latest shell workspace across persistent-shell navigation', async () => {
    const api = transport();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <AthenaPanelProvider transport={api} context={{ workspaceId: 'workspace_1' }}>
          <OpenButton />
        </AthenaPanelProvider>
      </QueryClientProvider>,
    );

    view.rerender(
      <QueryClientProvider client={client}>
        <AthenaPanelProvider transport={api} context={{ workspaceId: 'workspace_2' }}>
          <OpenButton />
        </AthenaPanelProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Athena' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open full Athena' })).toHaveAttribute(
        'href',
        '/athena?workspace=workspace_2&session=session_needs',
      );
    });
  });

  it('clears source context on same-workspace route navigation', async () => {
    const api = transport();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <AthenaPanelProvider
          transport={api}
          context={{ workspaceId: 'workspace_1' }}
          locationKey="/orgs/workspace_1/projects/project_1"
        >
          <OpenButton />
        </AthenaPanelProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open contextual Athena' }));
    expect(await screen.findByText('Athena launch')).toBeVisible();

    view.rerender(
      <QueryClientProvider client={client}>
        <AthenaPanelProvider
          transport={api}
          context={{ workspaceId: 'workspace_1' }}
          locationKey="/orgs/workspace_1/tasks/task_2"
        >
          <OpenButton />
        </AthenaPanelProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText('Athena launch')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open full Athena' })).toHaveAttribute(
        'href',
        '/athena?workspace=workspace_1&session=session_needs',
      );
    });
  });

  it('clears stale source and draft state on every contextual open', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Start contextual Athena' }));
    expect(await screen.findByLabelText('Athena objective')).toHaveValue('Prepare the review');
    fireEvent.click(screen.getByRole('button', { name: 'Close Athena' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open contextual Athena' }));
    expect(await screen.findByText('Athena launch')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close Athena' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open Athena' }));
    expect(screen.queryByText('Athena launch')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Athena objective')).not.toBeInTheDocument();
  });

  it('starts drafted work through the personal API instead of a local session route', async () => {
    const api = renderPanel();
    const create = vi.mocked(api.create);

    fireEvent.click(screen.getByRole('button', { name: 'Start contextual Athena' }));
    expect(await screen.findByRole('heading', { name: 'Start this work' })).toBeVisible();
    expect(screen.getByLabelText('Athena objective')).toHaveValue('Prepare the review');
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        prompt: 'Prepare the review',
        context: { workspaceId: 'workspace_1' },
      });
    });
  });
});
