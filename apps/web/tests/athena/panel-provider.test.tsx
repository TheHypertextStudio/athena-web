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
  it('keeps the redundant pulse out of the full personal workspace', () => {
    renderPanel(transport(), false);

    expect(screen.queryByRole('button', { name: 'Open Athena' })).not.toBeInTheDocument();
  });

  it('opens the same personal Athena everywhere with Cmd/Ctrl+J, including without a workspace', async () => {
    renderPanel();

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(await screen.findByRole('dialog', { name: 'Athena' })).toBeVisible();
    expect(await screen.findByText('1 needs you')).toBeVisible();
    expect(screen.getByText('2 working')).toBeVisible();
    expect(await screen.findByText('Confirm the private launch review change')).toBeVisible();
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
