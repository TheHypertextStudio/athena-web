/** Focused setup UI for repeating a project-shaped body of work. */
import '@testing-library/jest-dom/vitest';

import type { MilestoneOut } from '@docket/work/milestone-contract';
import type { ProjectOut } from '../../src/lib/contracts/project';
import type { TaskOut } from '@docket/work/task-model';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const requests = vi.hoisted(() => ({ definition: vi.fn(), series: vi.fn() }));
vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          'process-definitions': { 'from-project': { $post: requests.definition } },
          'recurrence-series': { $post: requests.series },
        },
      },
    },
  },
}));

import { RepeatProjectDialog } from '../../src/components/recurrence/repeat-project-dialog';
import { assertDefined } from '@docket/test-utils';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PROJECT = {
  id: 'PRJ00000000000000000000001',
  organizationId: '0RG00000000000000000000001',
  name: 'Intro to Urbanism Workshop',
  summary: 'A practical first workshop.',
  description: null,
  status: 'active',
  health: null,
  leadId: null,
  teamId: null,
  programId: null,
  startDate: '2026-09-10',
  targetDate: '2026-09-20',
  createdAt: '2026-08-01T00:00:00.000Z',
} as unknown as ProjectOut;

const MILESTONES = [
  {
    id: 'MLS00000000000000000000001',
    organizationId: PROJECT.organizationId,
    projectId: PROJECT.id,
    name: 'Workshop day',
    description: null,
    targetDate: '2026-09-18',
    sort: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
] as unknown as readonly MilestoneOut[];

function task(id: string, title: string): TaskOut {
  return {
    id,
    organizationId: PROJECT.organizationId,
    title,
    teamId: 'TEAM0000000000000000000002',
    state: 'backlog',
    priority: 'none',
    provenance: { source: 'native' },
    labels: [],
    createdAt: '2026-08-01T00:00:00.000Z',
  } as unknown as TaskOut;
}

describe('RepeatProjectDialog', () => {
  it('reviews the concrete work and explains both release modes in product language', () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RepeatProjectDialog
          open
          onOpenChange={vi.fn()}
          orgId={PROJECT.organizationId}
          project={PROJECT}
          milestones={MILESTONES}
          tasks={[
            {
              task: task('TSK00000000000000000000001', 'Publish the event'),
              milestoneId: assertDefined(MILESTONES[0]).id,
            },
            {
              task: task('TSK00000000000000000000002', 'Host workshop'),
              milestoneId: assertDefined(MILESTONES[0]).id,
            },
            { task: task('TSK00000000000000000000003', 'Send follow-ups'), milestoneId: null },
          ]}
          projectNoun="Project"
          onCreated={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Repeat this project' })).toBeTruthy();
    expect(screen.getByText('One project, 1 milestone, and 3 tasks.')).toBeTruthy();
    expect(screen.getByText('Publish the event')).toBeTruthy();
    expect(screen.getByText('Host workshop')).toBeTruthy();
    expect(screen.getByText('Send follow-ups')).toBeTruthy();

    const fullPlan = screen.getByRole('radio', { name: /Show the full plan/ });
    const whenReady = screen.getByRole('radio', { name: /Show tasks when ready/ });
    expect((fullPlan as HTMLInputElement).checked).toBe(true);
    fireEvent.click(whenReady);
    expect((whenReady as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByLabelText('Repeat cadence')).toHaveValue('monthly');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Show tasks when ready')).toBeInTheDocument();
    expect(screen.getByText('28 days, at least 2 occurrences')).toBeInTheDocument();
    expect(screen.getByText('Sep 10, 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit work settings' }));
    expect(screen.getByRole('radio', { name: /Show tasks when ready/ })).toBeChecked();
  });

  it('says why an empty project cannot repeat yet and holds the action', () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RepeatProjectDialog
          open
          onOpenChange={vi.fn()}
          orgId={PROJECT.organizationId}
          project={PROJECT}
          milestones={MILESTONES}
          tasks={[]}
          projectNoun="Project"
          onCreated={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});

function setup(onOpenChange = vi.fn(), onCreated = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const props = {
    open: true,
    onOpenChange,
    orgId: PROJECT.organizationId,
    project: PROJECT,
    milestones: MILESTONES,
    tasks: [
      { task: task('TSK00000000000000000000001', 'Prepare the workshop'), milestoneId: null },
    ],
    projectNoun: 'Project',
    onCreated,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <RepeatProjectDialog {...props} />
    </QueryClientProvider>,
  );
  return { ...view, props, client };
}

function review() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('Repeat project setup lifetime and submission', () => {
  it.each(['Cancel', 'Close', 'Escape'])(
    'protects changed work settings through %s',
    async (close) => {
      const onOpenChange = vi.fn();
      setup(onOpenChange);
      fireEvent.click(screen.getByRole('radio', { name: /Show tasks when ready/ }));
      if (close === 'Escape')
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      else fireEvent.click(screen.getByRole('button', { name: close }));
      expect(await screen.findByText('Discard this draft?')).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole('radio', { name: /Show tasks when ready/ })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      expect(screen.getByRole('radio', { name: /Show tasks when ready/ })).toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
  );

  it.each(['Cancel', 'Close', 'Escape'])(
    'closes unchanged setup through %s without a discard prompt',
    async (close) => {
      const onOpenChange = vi.fn();
      setup(onOpenChange);
      if (close === 'Escape')
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      else fireEvent.click(screen.getByRole('button', { name: close }));
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(screen.queryByText('Discard this draft?')).not.toBeInTheDocument();
    },
  );

  it('protects changed inline cadence on Escape and keeps the current step', async () => {
    const onOpenChange = vi.fn();
    setup(onOpenChange);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Repeat cadence'), {
      target: { value: 'after_completion' },
    });
    fireEvent.change(screen.getByLabelText('Wait after completion'), { target: { value: '3' } });
    fireEvent.keyDown(screen.getByLabelText('Wait after completion'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByText('Discard this draft?')).toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Wait after completion')).toHaveValue(3);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('3 days after completion')).toBeInTheDocument();
  });

  it('lets a person return to Repeat after choosing Does not repeat', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Repeat cadence'), { target: { value: 'none' } });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Repeat cadence'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Start repeating' })).toBeEnabled();
  });

  it.each(['calendar interval', 'occurrence count', 'completion delay'])(
    'blocks invalid %s before review or saving',
    (field) => {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      if (field === 'completion delay') {
        fireEvent.change(screen.getByLabelText('Repeat cadence'), {
          target: { value: 'after_completion' },
        });
        fireEvent.change(screen.getByLabelText('Wait after completion'), {
          target: { value: '1.5' },
        });
      } else if (field === 'occurrence count') {
        fireEvent.change(screen.getByLabelText('Repeat ends'), {
          target: { value: 'after_count' },
        });
        fireEvent.change(screen.getByLabelText('Number of occurrences'), {
          target: { value: '1.5' },
        });
      } else {
        fireEvent.change(screen.getByLabelText('Repeat interval'), { target: { value: '1.5' } });
      }
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
      expect(
        screen.getByText('Intervals and occurrence counts must be positive whole numbers.'),
      ).toBeInTheDocument();
      expect(requests.definition).not.toHaveBeenCalled();
      expect(requests.series).not.toHaveBeenCalled();
    },
  );

  it('returns focus to the edited control after Keep editing', async () => {
    setup();
    const releaseMode = screen.getByRole('radio', { name: /Show tasks when ready/ });
    releaseMode.focus();
    fireEvent.click(releaseMode);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(releaseMode).toHaveFocus();
    });
  });

  it('restarts at Work with default settings on each new opening', () => {
    const { rerender, props, client } = setup();
    fireEvent.click(screen.getByRole('radio', { name: /Show tasks when ready/ }));
    review();
    rerender(
      <QueryClientProvider client={client}>
        <RepeatProjectDialog {...props} open={false} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={client}>
        <RepeatProjectDialog {...props} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('radio', { name: /Show the full plan/ })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Start repeating' })).not.toBeInTheDocument();
  });

  it('posts the reviewed settings only after Start repeating and blocks dismissal while pending', async () => {
    requests.definition.mockResolvedValue(
      new Response(JSON.stringify({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })),
    );
    let complete: (value: Response) => void = () => {
      throw new Error('Series request did not start');
    };
    requests.series.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    setup(onOpenChange, onCreated);
    fireEvent.click(screen.getByRole('radio', { name: /Show tasks when ready/ }));
    review();
    expect(requests.definition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await waitFor(() => {
      expect(requests.series).toHaveBeenCalledOnce();
    });
    expect(requests.definition).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ creationMode: 'when_ready', projectId: PROJECT.id }),
      }),
      expect.objectContaining({ headers: { 'Idempotency-Key': expect.any(String) } }),
    );
    expect(requests.series).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          effectiveFrom: '2026-09-10',
          trigger: expect.objectContaining({
            kind: 'calendar',
            schedule: expect.objectContaining({ kind: 'monthly' }),
          }),
        }),
      }),
      expect.objectContaining({ headers: { 'Idempotency-Key': expect.any(String) } }),
    );
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    complete(new Response(JSON.stringify({ id: 'series_1' })));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('series_1');
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('submits an after-completion rule with the selected delay and unit', async () => {
    requests.definition.mockResolvedValue(
      new Response(JSON.stringify({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })),
    );
    requests.series.mockResolvedValue(new Response(JSON.stringify({ id: 'series_2' })));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Repeat cadence'), {
      target: { value: 'after_completion' },
    });
    fireEvent.change(screen.getByLabelText('Wait after completion'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Completion interval unit'), {
      target: { value: 'week' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('2 weeks after completion')).toBeInTheDocument();
    expect(screen.getByText('Sep 10, 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await waitFor(() => {
      expect(requests.series).toHaveBeenCalledOnce();
    });
    expect(requests.series).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          effectiveFrom: '2026-09-10',
          trigger: { kind: 'after_completion', interval: 2, unit: 'week' },
        }),
      }),
      expect.objectContaining({ headers: { 'Idempotency-Key': expect.any(String) } }),
    );
  });

  it('retries a lost definition response with the same durable request identity', async () => {
    requests.definition
      .mockRejectedValueOnce(new Error('Definition committed but response was lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })));
    requests.series.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'series_recovered' })));
    const onCreated = vi.fn();
    setup(vi.fn(), onCreated);
    review();
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await screen.findByText('Could not make this project repeatable. Try again.');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start repeating' })).toBeEnabled(),
    );
    expect(requests.series).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('series_recovered');
    });
    expect(requests.definition).toHaveBeenCalledTimes(2);
    const firstOptions = requests.definition.mock.calls[0]?.[1];
    expect(firstOptions).toEqual({ headers: { 'Idempotency-Key': expect.any(String) } });
    expect(requests.definition.mock.calls[1]?.[1]).toEqual(firstOptions);
    expect(requests.definition.mock.calls[1]?.[0]).toEqual(requests.definition.mock.calls[0]?.[0]);
  });

  it('reuses the saved definition when a failed schedule is retried', async () => {
    requests.definition.mockResolvedValue(
      new Response(JSON.stringify({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })),
    );
    requests.series
      .mockRejectedValueOnce(new Error('Transient schedule failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'series_retry' })));
    const onCreated = vi.fn();
    setup(vi.fn(), onCreated);
    review();
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await screen.findByText(
      'The reusable project was saved. Could not finish setting up this repeating project. Try again.',
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start repeating' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('series_retry');
    });
    expect(requests.definition).toHaveBeenCalledOnce();
    expect(requests.series).toHaveBeenCalledTimes(2);
    const firstOptions = requests.series.mock.calls[0]?.[1];
    expect(firstOptions).toEqual({ headers: { 'Idempotency-Key': expect.any(String) } });
    expect(requests.series.mock.calls[1]?.[1]).toEqual(firstOptions);
  });

  it('saves a new definition when work release settings change after a failed schedule', async () => {
    requests.definition
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAW' })));
    requests.series
      .mockRejectedValueOnce(new Error('Transient schedule failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'series_changed' })));
    const onCreated = vi.fn();
    setup(vi.fn(), onCreated);
    review();
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await screen.findByText(
      'The reusable project was saved. Could not finish setting up this repeating project. Try again.',
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit work settings' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit work settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Show tasks when ready/ }));
    review();
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('series_changed');
    });
    expect(requests.definition).toHaveBeenCalledTimes(2);
    expect(requests.series.mock.calls[1]?.[1]).not.toEqual(requests.series.mock.calls[0]?.[1]);
    expect(requests.definition).toHaveBeenLastCalledWith(
      expect.objectContaining({ json: expect.objectContaining({ creationMode: 'when_ready' }) }),
      expect.objectContaining({ headers: { 'Idempotency-Key': expect.any(String) } }),
    );
  });

  it('retains the review and selected settings when the schedule request fails', async () => {
    requests.definition.mockResolvedValue(
      new Response(JSON.stringify({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })),
    );
    requests.series.mockRejectedValue(new Error('Provider internals must stay private'));
    const onOpenChange = vi.fn();
    setup(onOpenChange);
    fireEvent.click(screen.getByRole('radio', { name: /Show tasks when ready/ }));
    review();
    fireEvent.click(screen.getByRole('button', { name: 'Start repeating' }));
    await waitFor(() => {
      expect(requests.series).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start repeating' })).toBeEnabled();
    });
    expect(screen.getByText('Show tasks when ready')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The reusable project was saved. Could not finish setting up this repeating project. Try again.',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Provider internals must stay private')).not.toBeInTheDocument();
  });
});
