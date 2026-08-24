import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  AthenaPanelProvider,
  AthenaRailPanel,
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
    activity: vi.fn().mockResolvedValue(okResponse({ items: [] })),
    sendMessage: vi.fn().mockResolvedValue(okResponse(detail)),
    create: vi.fn().mockResolvedValue(okResponse(detail)),
    decide: vi.fn().mockResolvedValue(okResponse(detail)),
    lifecycle: vi.fn().mockResolvedValue(okResponse(detail)),
  };
}

function AthenaLaunchers(): ReactNode {
  const { openAthena, railStatus } = useAthenaPanel();
  return (
    <>
      <span data-testid="athena-rail-status">{railStatus?.tone ?? 'none'}</span>
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
    </>
  );
}

function renderPanel(
  options: {
    readonly api?: PersonalAthenaTransport;
    readonly railVisible?: boolean;
    readonly onRevealRail?: (() => void) | undefined;
    readonly onOpenFullAthena?: ((context: unknown, draft: string | undefined) => void) | undefined;
  } = {},
): PersonalAthenaTransport {
  const api = options.api ?? transport();
  const railVisible = options.railVisible ?? true;
  const onRevealRail = 'onRevealRail' in options ? options.onRevealRail : vi.fn();
  const onOpenFullAthena = options.onOpenFullAthena ?? vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AthenaPanelProvider
        transport={api}
        railVisible={railVisible}
        onRevealRail={onRevealRail}
        onOpenFullAthena={onOpenFullAthena}
      >
        <AthenaLaunchers />
        <AthenaRailPanel />
      </AthenaPanelProvider>
    </QueryClientProvider>,
  );
  return api;
}

describe('AthenaPanelProvider', () => {
  it('uses attention before active work in the accessible rail status', async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('athena-rail-status')).toHaveTextContent('attention');
    });
  });

  it('does not fetch the full queue until the shell shows Athena’s panel', async () => {
    const api = renderPanel({ railVisible: false });

    await waitFor(() => {
      expect(api.pulse).toHaveBeenCalled();
    });
    expect(api.queue).not.toHaveBeenCalled();
    expect(api.detail).not.toHaveBeenCalled();
  });

  it('uses Cmd/Ctrl J to ask the shell to reveal Athena without rendering a floating dialog', async () => {
    const onRevealRail = vi.fn();
    renderPanel({ onRevealRail });

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    await waitFor(() => {
      expect(onRevealRail).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog', { name: 'Athena' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Athena' })).not.toBeInTheDocument();
  });

  it('keeps the shortcut out of editable controls', () => {
    const onRevealRail = vi.fn();
    renderPanel({ onRevealRail });
    const input = document.createElement('input');
    document.body.append(input);

    fireEvent.keyDown(input, { key: 'j', metaKey: true });

    expect(onRevealRail).not.toHaveBeenCalled();
    input.remove();
  });

  it('replaces the queue with one selected session and restores it with Back', async () => {
    renderPanel();
    const session = await screen.findByRole('button', {
      name: /Confirm the private launch review change/,
    });

    fireEvent.click(session);

    expect(await screen.findByRole('button', { name: 'Back' })).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: 'Confirm the private launch review change' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('button', { name: /Confirm the private launch review change/ }),
    ).toBeVisible();
  });

  it('opens a contextual composer in the rail and retains the context in the full-workspace URL', async () => {
    const onRevealRail = vi.fn();
    const api = renderPanel({ onRevealRail, railVisible: false });

    fireEvent.click(screen.getByRole('button', { name: 'Open contextual Athena' }));

    expect(onRevealRail).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Start this work' })).toBeVisible();
    expect(screen.getByLabelText('Athena objective')).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Open full Athena' })).toHaveAttribute(
      'href',
      '/athena?workspace=workspace_1&context=project%3Aproject_1&contextLabel=Athena+launch&new=1',
    );
    expect(api.detail).not.toHaveBeenCalled();
  });

  it('opens Calendar context in the full Athena workspace because Calendar has no rail', () => {
    const onOpenFullAthena = vi.fn();
    renderPanel({ onRevealRail: undefined, onOpenFullAthena });

    fireEvent.click(screen.getByRole('button', { name: 'Open contextual Athena' }));

    expect(onOpenFullAthena).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace_1',
        source: { type: 'project', id: 'project_1', label: 'Athena launch' },
      },
      undefined,
    );
  });

  it('uses owned copy when Athena’s queue cannot load', async () => {
    const api = transport();
    vi.mocked(api.queue).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}) as never,
    });
    renderPanel({ api });

    expect(
      await screen.findByText("Athena is temporarily unavailable. We'll keep checking."),
    ).toBeVisible();
  });

  it('keeps a Back path and owned copy when the selected session cannot load', async () => {
    const api = transport();
    vi.mocked(api.detail).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}) as never,
    });
    renderPanel({ api });

    fireEvent.click(
      await screen.findByRole('button', { name: /Confirm the private launch review change/ }),
    );

    expect(
      await screen.findByText("Athena is temporarily unavailable. We'll keep checking."),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
  });
});
