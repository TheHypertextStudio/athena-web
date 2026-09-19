/**
 * Behavior test for {@link JobSteps}' controlled disclosure.
 *
 * @remarks
 * Pins the fix for the review finding on the uncontrolled `Collapsible`: a job card mounts once
 * while running (`forceExpanded` false) and stays mounted after the job finishes (`forceExpanded`
 * true) — the disclosure must open when `forceExpanded` flips, not only at first mount.
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
  it('stays collapsed while running, then opens once the job finishes without a remount', async () => {
    const { rerender } = render(
      <JobSteps
        activities={ACTIVITIES}
        forceExpanded={false}
        isFinished={false}
        undoneChangeSetIds={new Set()}
        undoPending={false}
        onUndo={vi.fn()}
      />,
    );

    expect(screen.queryByRole('list', { name: 'What Athena did' })).not.toBeInTheDocument();
    expect(screen.queryByText('Protected focus time')).not.toBeInTheDocument();

    rerender(
      <JobSteps
        activities={ACTIVITIES}
        forceExpanded
        isFinished
        undoneChangeSetIds={new Set()}
        undoPending={false}
        onUndo={vi.fn()}
      />,
    );

    expect(await screen.findByRole('list', { name: 'What Athena did' })).toBeInTheDocument();
    expect(screen.getByText('Protected focus time')).toBeVisible();
  });

  it('never re-collapses a disclosure the person opened themselves once forceExpanded clears', async () => {
    const { rerender } = render(
      <JobSteps
        activities={ACTIVITIES}
        forceExpanded={false}
        isFinished={false}
        undoneChangeSetIds={new Set()}
        undoPending={false}
        onUndo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1 steps' }));
    expect(await screen.findByText('Protected focus time')).toBeVisible();

    rerender(
      <JobSteps
        activities={ACTIVITIES}
        forceExpanded={false}
        isFinished={false}
        undoneChangeSetIds={new Set()}
        undoPending={false}
        onUndo={vi.fn()}
      />,
    );

    expect(screen.getByText('Protected focus time')).toBeVisible();
  });
});
