/**
 * Behavior tests for {@link JobSteps}.
 *
 * @remarks
 * Steps stay collapsed behind their "N steps" trigger in every lifecycle state — running or
 * finished — and only a person's own click opens them; the card never forces the disclosure
 * open on its own. These also pin the step renderer's own rules: the job's initiating message is
 * dropped (the objective already carries it as the card's heading), a later message from the
 * person reads "You: <text>", and a progress narration shows only its own text.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobSteps } from '../../src/components/athena/job-card-steps';
import type { AthenaActivityPresentation } from '../../src/lib/athena/presentation';

const ACTIVITIES: readonly AthenaActivityPresentation[] = [
  {
    id: 'tool_1',
    kind: 'tool',
    title: 'Protected focus time',
    detail: 'Added 2 blocks to Thursday',
    createdAt: '2026-09-18T16:00:00.000Z',
  },
];

afterEach(() => {
  cleanup();
});

describe('JobSteps', () => {
  it('stays collapsed by default whether the job is running or finished, and opens on click', async () => {
    const { rerender } = render(
      <JobSteps
        activities={ACTIVITIES}
        isFinished={false}
        undoneChangeSetIds={new Set()}
        undoPending={false}
        onUndo={vi.fn()}
      />,
    );

    expect(screen.queryByRole('list', { name: 'What Athena did' })).not.toBeInTheDocument();

    rerender(
      <JobSteps
        activities={ACTIVITIES}
        isFinished
        undoneChangeSetIds={new Set()}
        undoPending={false}
        onUndo={vi.fn()}
      />,
    );

    expect(screen.queryByRole('list', { name: 'What Athena did' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1 steps' }));
    expect(await screen.findByText('Protected focus time')).toBeVisible();
  });

  it('drops the initiating message and shows a later one as "You: <text>", counted among the steps', async () => {
    const activities: readonly AthenaActivityPresentation[] = [
      {
        id: 'message_1',
        kind: 'message',
        title: 'You asked',
        detail: 'Protect two hours for the launch review',
        createdAt: '2026-09-18T15:59:00.000Z',
      },
      ...ACTIVITIES,
      {
        id: 'message_2',
        kind: 'message',
        title: 'You asked',
        detail: 'Actually, make it three hours.',
        createdAt: '2026-09-18T16:01:00.000Z',
      },
    ];

    render(
      <JobSteps
        activities={activities}
        isFinished={false}
        undoneChangeSetIds={new Set()}
        undoPending={false}
        onUndo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '2 steps' }));

    expect(screen.queryByText('Protect two hours for the launch review')).not.toBeInTheDocument();
    expect(await screen.findByText('You: Actually, make it three hours.')).toBeVisible();
    expect(screen.getByText('Protected focus time')).toBeVisible();
  });

  it('shows a progress step as its own text, with no separate "Progress" heading', async () => {
    const activities: readonly AthenaActivityPresentation[] = [
      {
        id: 'progress_1',
        kind: 'progress',
        title: 'Progress',
        detail: 'Checking the calendar for conflicts',
        createdAt: '2026-09-18T16:00:00.000Z',
      },
    ];

    render(
      <JobSteps
        activities={activities}
        isFinished={false}
        undoneChangeSetIds={new Set()}
        undoPending={false}
        onUndo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1 steps' }));

    expect(await screen.findByText('Checking the calendar for conflicts')).toBeVisible();
    expect(screen.queryByText('Progress')).not.toBeInTheDocument();
  });
});
