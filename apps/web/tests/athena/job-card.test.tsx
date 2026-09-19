import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AthenaJobCard } from '../../src/components/athena/athena-job-card';
import type {
  PersonalAthenaDecision,
  PersonalAthenaSessionDetail,
  PersonalAthenaSessionSummary,
} from '../../src/lib/athena/presentation';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';
import { okResponse } from '../support/query';

function job(overrides: Partial<PersonalAthenaSessionSummary> = {}): PersonalAthenaSessionSummary {
  return {
    id: 'session_1',
    objective: 'Protect two hours for the launch review',
    status: 'running',
    queueState: 'working',
    workspace: { id: 'workspace_1', name: 'Hypertext Studio' },
    createdAt: '2026-07-15T15:00:00.000Z',
    updatedAt: '2026-07-15T16:00:00.000Z',
    ...overrides,
  };
}

function detailWith(
  overrides: Partial<PersonalAthenaSessionDetail> = {},
): PersonalAthenaSessionDetail {
  return {
    ...job(),
    activities: [],
    ...overrides,
  };
}

function transportFor(detail: PersonalAthenaSessionDetail): PersonalAthenaTransport {
  return {
    pulse: vi.fn(),
    queue: vi.fn(),
    detail: vi.fn().mockResolvedValue(okResponse(detail)),
    activity: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(okResponse(detail)),
    decide: vi.fn().mockResolvedValue(okResponse(detail)),
    lifecycle: vi.fn().mockResolvedValue(okResponse(detail)),
    undoChange: vi.fn().mockResolvedValue(okResponse({ changeSetId: 'change_1', undone: true })),
    proposals: vi.fn(),
  };
}

function renderCard(
  session: PersonalAthenaSessionSummary,
  detail: PersonalAthenaSessionDetail,
): PersonalAthenaTransport {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = transportFor(detail);
  render(
    <QueryClientProvider client={client}>
      <AthenaJobCard job={session} transport={api} />
    </QueryClientProvider>,
  );
  return api;
}

function openMenu(): void {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'More' }), {
    button: 0,
    ctrlKey: false,
  });
}

afterEach(() => {
  cleanup();
});

describe('AthenaJobCard', () => {
  it('renders the objective and the plain-language state label', async () => {
    renderCard(
      job(),
      detailWith({
        activities: [
          {
            id: 'tool_1',
            type: 'tool',
            createdAt: '2026-07-15T16:02:00.000Z',
            service: 'Sunsama',
            action: 'Protected focus time',
          },
        ],
      }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Protect two hours for the launch review' }),
    ).toBeVisible();
    expect(screen.getByText('Working', { selector: 'span' })).toBeVisible();
  });

  it('shows a pending approval and calls decide with the chosen option', async () => {
    const decision: PersonalAthenaDecision = {
      kind: 'approval',
      id: 'proposal_1',
      title: 'Move the launch review',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Keep current time' },
      ],
    };
    const api = renderCard(
      job({ status: 'awaiting_approval', queueState: 'needs_you' }),
      detailWith({ status: 'awaiting_approval', queueState: 'needs_you', decision }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(api.decide).toHaveBeenCalledWith('session_1', 'proposal_1', 'approve');
    });
  });

  it('follows the loaded detail past the summary once a decision moves the job along', async () => {
    // Regression for the badge, the overflow menu's gating, and the poll cadence all reading only
    // `job.status` (fixed at `awaiting_approval` for the life of this card) instead of the loaded
    // detail's own status once a decision has carried the job on to `running`.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const decision: PersonalAthenaDecision = {
        kind: 'approval',
        id: 'proposal_1',
        title: 'Move the launch review',
        options: [
          { id: 'approve', label: 'Approve' },
          { id: 'reject', label: 'Keep current time' },
        ],
      };
      const pendingDetail = detailWith({
        status: 'awaiting_approval',
        queueState: 'needs_you',
        decision,
      });
      const runningDetail = detailWith({
        status: 'running',
        queueState: 'working',
        decision: null,
      });

      // The transport is stateful, like the real API: every `detail` call after the decision
      // reflects the server's new status, whether that call comes from the mutation's own
      // `invalidateKeys` reconciliation (which prefix-matches this session's key) or the
      // re-armed poll — neither should ever hand the card a stale `awaiting_approval` again.
      let current = pendingDetail;
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const api: PersonalAthenaTransport = {
        pulse: vi.fn(),
        queue: vi.fn(),
        detail: vi.fn().mockImplementation(() => Promise.resolve(okResponse(current))),
        activity: vi.fn(),
        create: vi.fn(),
        sendMessage: vi.fn(),
        decide: vi.fn().mockImplementation(() => {
          current = runningDetail;
          return Promise.resolve(okResponse(runningDetail));
        }),
        lifecycle: vi.fn(),
        undoChange: vi.fn(),
        proposals: vi.fn(),
      };

      render(
        <QueryClientProvider client={client}>
          <AthenaJobCard
            job={job({ status: 'awaiting_approval', queueState: 'needs_you' })}
            transport={api}
          />
        </QueryClientProvider>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

      await waitFor(() => {
        expect(api.decide).toHaveBeenCalledWith('session_1', 'proposal_1', 'approve');
      });

      // The badge follows the loaded detail's status, not the summary's fixed `awaiting_approval`.
      expect(await screen.findByText(/Working/, { selector: 'span' })).toBeVisible();
      const callsAfterDecision = vi.mocked(api.detail).mock.calls.length;

      // The live status now reads `running` (tone `active`), so the poll interval re-arms at 3s
      // — advancing fake time by more than that proves the card is polling again, not stuck at
      // `false` the way it was while the interval was still keyed off the stale summary status.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });

      await waitFor(() => {
        expect(vi.mocked(api.detail).mock.calls.length).toBeGreaterThan(callsAfterDecision);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an optionless question as a free-text answer field', async () => {
    const decision: PersonalAthenaDecision = {
      kind: 'question',
      id: 'elicitation_1',
      title: 'Which launch task should I update?',
      options: [],
    };
    const api = renderCard(
      job({ status: 'awaiting_input', queueState: 'needs_you' }),
      detailWith({ status: 'awaiting_input', queueState: 'needs_you', decision }),
    );

    fireEvent.change(await screen.findByRole('combobox', { name: 'Answer Athena' }), {
      target: { value: 'Update the launch checklist.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(api.decide).toHaveBeenCalledWith('session_1', 'elicitation_1', 'reply', {
        body: 'Update the launch checklist.',
      });
    });
  });

  it('shows lifecycle items only when allowed and calls lifecycle', async () => {
    const api = renderCard(job({ status: 'running' }), detailWith({ status: 'running' }));
    await screen.findByRole('heading', { name: job().objective });

    openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));

    await waitFor(() => {
      expect(api.lifecycle).toHaveBeenCalledWith('session_1', 'pause');
    });
  });

  it('sends a reply through sendMessage', async () => {
    const api = renderCard(job(), detailWith());
    await screen.findByRole('heading', { name: job().objective });

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Reply' }), {
      target: { value: 'Keep going.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(api.sendMessage).toHaveBeenCalledWith('session_1', { body: 'Keep going.' });
    });
  });

  it('names the technical disclosure inside the expanded steps', async () => {
    renderCard(
      job(),
      detailWith({
        activities: [
          {
            id: 'tool_1',
            type: 'tool',
            createdAt: '2026-07-15T16:02:00.000Z',
            service: 'Sunsama',
            action: 'Protected focus time',
            outcome: 'Added 2 blocks to Thursday',
            technical: { toolName: 'sunsama_create_task' },
          },
        ],
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: '1 steps' }));
    fireEvent.click(await screen.findByText('Details'));
    expect(screen.getByText(/sunsama_create_task/)).toBeVisible();
  });

  it('collapses the steps behind an "N steps" trigger, listing every step flat once opened', async () => {
    const activities = Array.from({ length: 5 }, (_, index) => ({
      id: `tool_${String(index)}`,
      type: 'tool' as const,
      createdAt: `2026-07-15T16:0${String(index)}:00.000Z`,
      service: 'Sunsama',
      action: `Step ${String(index)}`,
    }));
    renderCard(job({ status: 'running' }), detailWith({ status: 'running', activities }));

    const trigger = await screen.findByRole('button', { name: '5 steps' });
    expect(screen.queryByRole('list', { name: 'What Athena did' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const steps = within(await screen.findByRole('list', { name: 'What Athena did' }));
    expect(steps.getByText(/Step 0/)).toBeInTheDocument();
    expect(steps.getByText(/Step 4/)).toBeInTheDocument();
  });

  it('shows one result line and the receipt rows when the work is finished, with no lifecycle menu, Reply, or repeated summary', async () => {
    renderCard(
      job({ status: 'completed', queueState: 'finished' }),
      detailWith({
        status: 'completed',
        queueState: 'finished',
        activities: [
          {
            id: 'tool_1',
            type: 'tool',
            createdAt: '2026-07-15T16:02:00.000Z',
            service: 'Docket',
            action: 'Moved the review',
          },
        ],
        result: {
          title: 'Launch review moved',
          summary: 'Thursday at 2:00 PM is confirmed.',
          receipt: [{ label: 'New time', value: 'Thu 2:00 PM' }],
        },
      }),
    );

    expect(await screen.findAllByText('Thursday at 2:00 PM is confirmed.')).toHaveLength(1);
    expect(screen.getByText('Thu 2:00 PM')).toBeVisible();
    expect(screen.queryByText('Launch review moved')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();

    // The steps stay collapsed behind their trigger even though the job is finished — nothing
    // forces them open on its own.
    expect(screen.queryByRole('list', { name: 'What Athena did' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 steps' })).toBeInTheDocument();
  });

  it('shows only the result line when a finished job left no receipt rows and nothing to undo', async () => {
    renderCard(
      job({ status: 'completed', queueState: 'finished' }),
      detailWith({
        status: 'completed',
        queueState: 'finished',
        result: { title: 'Launch review moved', summary: 'Thursday at 2:00 PM is confirmed.' },
      }),
    );

    expect(await screen.findAllByText('Thursday at 2:00 PM is confirmed.')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('offers Undo on a finished step and its receipt, marking both Undone once reversed', async () => {
    const detail = detailWith({
      status: 'completed',
      queueState: 'finished',
      activities: [
        {
          id: 'tool_1',
          type: 'tool',
          createdAt: '2026-07-15T16:02:00.000Z',
          service: 'Docket',
          action: 'Created task',
          technical: { toolName: 'create_task', output: { changeSetId: 'cs_1' } },
        },
      ],
      result: {
        title: 'Task created',
        summary: 'Booked the inspection.',
      },
    });
    const api = renderCard(job({ status: 'completed', queueState: 'finished' }), detail);

    // The step's own Undo sits behind the collapsed "N steps" trigger; the receipt's copy sits
    // in the open, so opening the steps is what brings both into view.
    fireEvent.click(await screen.findByRole('button', { name: '1 steps' }));

    const undoButtons = await screen.findAllByRole('button', { name: 'Undo' });
    expect(undoButtons).toHaveLength(2);

    fireEvent.click(undoButtons[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(api.undoChange).toHaveBeenCalledWith('cs_1');
    });
    expect(await screen.findAllByText('Undone')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('reads Review on an outward decision and reveals what would go out before it reads Approve', async () => {
    const decision: PersonalAthenaDecision = {
      kind: 'approval',
      id: 'proposal_1',
      title: 'Send the launch update',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Keep it a draft' },
      ],
    };
    const api = renderCard(
      job({ status: 'awaiting_approval', queueState: 'needs_you' }),
      detailWith({
        status: 'awaiting_approval',
        queueState: 'needs_you',
        decision,
        activities: [
          {
            id: 'tool_1',
            type: 'tool',
            createdAt: '2026-07-15T16:02:00.000Z',
            service: 'Gmail',
            action: 'Drafted the update',
            technical: {
              toolName: 'send_email',
              input: { to: 'team@example.com', subject: 'Launch update', body: 'It shipped.' },
            },
          },
        ],
      }),
    );

    expect(await screen.findByRole('button', { name: 'Review' })).toBeVisible();
    expect(screen.queryByText('team@example.com')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(api.decide).not.toHaveBeenCalled();
    expect(screen.getByText('team@example.com')).toBeVisible();
    expect(screen.getByText('Launch update')).toBeVisible();
    expect(screen.getByText('It shipped.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(api.decide).toHaveBeenCalledWith('session_1', 'proposal_1', 'approve');
    });
  });

  it('names the pending decision from the tool call, not the API title, in both the status line and the decision block', async () => {
    const decision: PersonalAthenaDecision = {
      kind: 'approval',
      id: 'proposal_1',
      title: 'update task',
      options: [{ id: 'approve', label: 'Approve' }],
    };
    renderCard(
      job({ status: 'awaiting_approval', queueState: 'needs_you' }),
      detailWith({
        status: 'awaiting_approval',
        queueState: 'needs_you',
        decision,
        activities: [
          {
            id: 'tool_1',
            type: 'tool',
            createdAt: '2026-07-15T16:02:00.000Z',
            service: 'Docket',
            action: 'update task',
            technical: { toolName: 'update_task', input: { state: 'in_progress' } },
          },
        ],
      }),
    );

    expect(await screen.findAllByText('Set state to In Progress')).toHaveLength(2);
    expect(screen.queryByText('update task')).not.toBeInTheDocument();
  });

  it('puts the More menu button beside the heading, in the same row, at any width', async () => {
    renderCard(job({ status: 'running' }), detailWith({ status: 'running' }));

    const heading = await screen.findByRole('heading', { name: job().objective });
    const menuButton = await screen.findByRole('button', { name: 'More' });

    expect(heading.parentElement).toBe(menuButton.parentElement);
  });
});
