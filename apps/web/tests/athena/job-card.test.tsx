import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AthenaJobCard } from '../../src/components/athena/athena-job-card';
import type {
  PersonalAthenaActivity,
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

/** A Docket `update_task` step with its raw call carried through. */
function updateStep(overrides: Partial<Extract<PersonalAthenaActivity, { type: 'tool' }>> = {}) {
  return {
    id: 'tool_1',
    type: 'tool' as const,
    createdAt: '2026-07-15T16:02:00.000Z',
    service: 'Docket',
    action: 'update task',
    technical: { toolName: 'update_task', input: { state: 'in_progress' } },
    ...overrides,
  };
}

const APPROVAL: PersonalAthenaDecision = {
  kind: 'approval',
  id: 'proposal_1',
  title: 'update task',
  options: [
    { id: 'approve', label: 'Approve' },
    { id: 'reject', label: 'Reject' },
  ],
};

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
  copies = 1,
): PersonalAthenaTransport {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = transportFor(detail);
  render(
    <QueryClientProvider client={client}>
      {Array.from({ length: copies }, (_, index) => (
        <AthenaJobCard key={index} job={session} transport={api} />
      ))}
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

function stateLine(): HTMLElement {
  const line = document.querySelector<HTMLElement>('[data-slot="athena-job-state"]');
  if (!line) throw new Error('no state line');
  return line;
}

afterEach(() => {
  cleanup();
});

describe('AthenaJobCard', () => {
  it('renders the objective as a flat entry with a state dot and one state line, and no badge', async () => {
    renderCard(job(), detailWith({ activities: [updateStep()] }));

    const entry = await screen.findByRole('article', { name: job().objective });
    expect(entry).toHaveAttribute('data-state', 'active');
    expect(entry.querySelector('[data-slot="athena-job-dot"]')).not.toBeNull();
    expect(entry.querySelectorAll('[data-slot="athena-job-state"]')).toHaveLength(1);
    expect(entry.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('gives each copy of the same job its own ids, each labelled by its own title', async () => {
    renderCard(job(), detailWith(), 2);

    const entries = await screen.findAllByRole('article', { name: job().objective });
    expect(entries).toHaveLength(2);
    const [first, second] = entries as [HTMLElement, HTMLElement];
    expect(first.id).not.toBe(second.id);
    expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
    expect(first).toHaveAttribute('data-athena-job', 'session_1');
  });

  it('shows the decision sentence once, on the decision line and never in the state line', async () => {
    renderCard(
      job({ status: 'awaiting_approval', queueState: 'needs_you' }),
      detailWith({
        status: 'awaiting_approval',
        queueState: 'needs_you',
        decision: APPROVAL,
        activities: [updateStep()],
      }),
    );

    const decisionBlock = await waitFor(() => {
      const block = document.querySelector<HTMLElement>('[data-slot="athena-job-decision"]');
      if (!block) throw new Error('decision not rendered yet');
      return block;
    });
    const sentence = decisionBlock.querySelector('p')?.textContent ?? '';
    expect(sentence.length).toBeGreaterThan(0);
    expect(stateLine()).not.toHaveTextContent(sentence);
    expect(screen.queryByRole('heading', { level: 4 })).not.toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'attention');
  });

  it('shows a pending approval and calls decide with the chosen option', async () => {
    const api = renderCard(
      job({ status: 'awaiting_approval', queueState: 'needs_you' }),
      detailWith({ status: 'awaiting_approval', queueState: 'needs_you', decision: APPROVAL }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(api.decide).toHaveBeenCalledWith('session_1', 'proposal_1', 'approve');
    });
  });

  it('follows the loaded detail past the summary once a decision moves the job along', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pendingDetail = detailWith({
        status: 'awaiting_approval',
        queueState: 'needs_you',
        decision: APPROVAL,
      });
      const runningDetail = detailWith({
        status: 'running',
        queueState: 'working',
        decision: null,
      });

      let current = pendingDetail;
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const api: PersonalAthenaTransport = {
        ...transportFor(pendingDetail),
        detail: vi.fn().mockImplementation(() => Promise.resolve(okResponse(current))),
        decide: vi.fn().mockImplementation(() => {
          current = runningDetail;
          return Promise.resolve(okResponse(runningDetail));
        }),
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

      // The entry's state follows the loaded detail, not the summary's fixed `awaiting_approval`.
      await waitFor(() => {
        expect(screen.getByRole('article')).toHaveAttribute('data-state', 'active');
      });
      const callsAfterDecision = vi.mocked(api.detail).mock.calls.length;

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

    fireEvent.change(await screen.findByRole('combobox', { name: 'Answer' }), {
      target: { value: 'Update the launch checklist.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(api.decide).toHaveBeenCalledWith('session_1', 'elicitation_1', 'reply', {
        body: 'Update the launch checklist.',
      });
    });
  });

  it('offers Reply, Pause, and Cancel in the overflow menu while running, and calls lifecycle', async () => {
    const api = renderCard(job({ status: 'running' }), detailWith({ status: 'running' }));
    await screen.findByRole('heading', { name: job().objective });

    openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Reply' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));

    await waitFor(() => {
      expect(api.lifecycle).toHaveBeenCalledWith('session_1', 'pause');
    });
  });

  it('opens the reply field from the overflow menu and sends through sendMessage', async () => {
    const api = renderCard(job(), detailWith());
    await screen.findByRole('heading', { name: job().objective });
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();

    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Reply' }), {
      target: { value: 'Keep going.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(api.sendMessage).toHaveBeenCalledWith('session_1', { body: 'Keep going.' });
    });
  });

  it('keeps the overflow menu in place on a finished entry, disabled', async () => {
    renderCard(
      job({ status: 'completed', queueState: 'finished' }),
      detailWith({ status: 'completed', queueState: 'finished' }),
    );

    const heading = await screen.findByRole('heading', { name: job().objective });
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toBeDisabled();
    expect(heading.parentElement).toBe(more.parentElement);
  });

  it('never reads as a success when the only change failed: nothing changed, and why', async () => {
    renderCard(
      job({ status: 'completed', queueState: 'finished' }),
      detailWith({
        status: 'completed',
        queueState: 'finished',
        activities: [updateStep({ failed: true, outcome: 'This action could not be completed.' })],
        result: { title: 'Work finished', summary: 'Moved the task to In Progress.' },
      }),
    );

    const receipt = await waitFor(() => {
      const block = document.querySelector<HTMLElement>('[data-slot="athena-job-receipt"]');
      if (!block) throw new Error('receipt not rendered yet');
      return block;
    });
    expect(receipt.querySelector('ul')).toBeNull();
    expect(receipt).toHaveTextContent('set state to In Progress');
    expect(screen.getByRole('article')).not.toHaveTextContent('Moved the task to In Progress.');
    expect(screen.getByRole('article')).not.toHaveTextContent('could not be completed');
    expect(stateLine()).not.toHaveTextContent(/\d+ change/);
  });

  it('lists one receipt line per change that landed', async () => {
    renderCard(
      job({ status: 'completed', queueState: 'finished' }),
      detailWith({
        status: 'completed',
        queueState: 'finished',
        activities: [
          updateStep({ id: 'a', applied: true }),
          updateStep({ id: 'b', applied: true }),
        ],
      }),
    );

    const receipt = await waitFor(() => {
      const block = document.querySelector<HTMLElement>('[data-slot="athena-job-receipt"]');
      if (!block) throw new Error('receipt not rendered yet');
      return block;
    });
    expect(within(receipt).getAllByRole('listitem')).toHaveLength(2);
    expect(stateLine()).toHaveTextContent(/2 changes$/);
  });

  it('shows no receipt on a stopped entry; its state line carries the outcome', async () => {
    renderCard(
      job({ status: 'failed', queueState: 'finished' }),
      detailWith({
        status: 'failed',
        queueState: 'finished',
        activities: [updateStep({ failed: true })],
      }),
    );

    await waitFor(() => {
      expect(stateLine()).toHaveTextContent('set state to In Progress');
    });
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'stopped');
    expect(document.querySelector('[data-slot="athena-job-receipt"]')).toBeNull();
  });

  it('collapses the steps behind a pluralised count, listing every step flat once opened', async () => {
    const activities = Array.from({ length: 5 }, (_, index) => ({
      id: `tool_${String(index)}`,
      type: 'tool' as const,
      createdAt: `2026-07-15T16:0${String(index)}:00.000Z`,
      service: 'Sunsama',
      action: `Step ${String(index)}`,
    }));
    renderCard(job({ status: 'running' }), detailWith({ status: 'running', activities }));

    const trigger = await screen.findByRole('button', { name: /^5 steps$/ });
    expect(screen.queryByRole('list', { name: 'Steps' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const steps = await screen.findByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5);
  });

  it('offers Undo on a finished step and its receipt, and clears both once reversed', async () => {
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
          applied: true,
          technical: { toolName: 'create_task', output: { changeSetId: 'cs_1' } },
        },
      ],
    });
    const api = renderCard(job({ status: 'completed', queueState: 'finished' }), detail);

    fireEvent.click(await screen.findByRole('button', { name: /^1 step$/ }));

    const undoButtons = await screen.findAllByRole('button', { name: 'Undo' });
    expect(undoButtons).toHaveLength(2);

    fireEvent.click(undoButtons[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(api.undoChange).toHaveBeenCalledWith('cs_1');
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    });
  });

  it('reads Review on an outward decision and reveals what would go out before it reads Approve', async () => {
    const api = renderCard(
      job({ status: 'awaiting_approval', queueState: 'needs_you' }),
      detailWith({
        status: 'awaiting_approval',
        queueState: 'needs_you',
        decision: APPROVAL,
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

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(api.decide).toHaveBeenCalledWith('session_1', 'proposal_1', 'approve');
    });
  });
});
