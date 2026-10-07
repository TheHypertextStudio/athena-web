import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';

const state = vi.hoisted(() => ({ assess: vi.fn(), openCreate: vi.fn() }));
vi.mock('../../src/components/daily-planning/daily-planning-assessment-queries', () => ({
  useDailyPlanAssessment: () => ({ mutateAsync: state.assess }),
}));
vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: state.openCreate }),
}));
import { DailyPlanningAssessment } from '../../src/components/daily-planning/daily-planning-assessment';

const draft: DailyPlanSnapshot = {
  date: '2026-10-06',
  finishAt: '2026-10-07T00:00:00.000Z',
  mainTaskId: null,
  tasks: [],
  sessions: [],
};
const suggestion = {
  projectId: 'project',
  organizationId: 'org',
  projectName: 'Launch',
  title: 'Prepare release checklist',
  reason: 'Release is tomorrow.',
};
beforeEach(() => {
  vi.useFakeTimers();
  state.assess.mockReset();
  state.openCreate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
}

describe('optional Athena planning review', () => {
  it('shows a real note and opens the existing composer with project context', async () => {
    state.assess.mockImplementation(async ({ proposalFingerprint }) => ({
      proposalFingerprint,
      assessment: 'The afternoon leaves room for release preparation.',
      suggestions: [suggestion],
    }));
    const onTaskCreated = vi.fn();
    render(<DailyPlanningAssessment draft={draft} onTaskCreated={onTaskCreated} />);
    await settle();
    expect(screen.getByText('The afternoon leaves room for release preparation.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add Prepare release checklist' }));
    expect(state.openCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'task',
        initialWorkspaceId: 'org',
        defaultProjectId: 'project',
        initialTitle: 'Prepare release checklist',
        sameWorkspaceCompletion: 'stay',
        onCreated: expect.any(Function),
      }),
      expect.any(HTMLElement),
    );
    state.openCreate.mock.calls[0]?.[0].onCreated({
      id: 'created',
      organizationId: 'org',
      title: 'Prepare release checklist',
    });
    expect(onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'created' }));
  });
  it('discards a response after a material draft edit', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    let oldToken = '';
    state.assess.mockImplementation(({ proposalFingerprint }) => {
      oldToken = proposalFingerprint;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const view = render(<DailyPlanningAssessment draft={draft} onTaskCreated={vi.fn()} />);
    await settle();
    view.rerender(
      <DailyPlanningAssessment
        draft={{ ...draft, finishAt: '2026-10-07T01:00:00.000Z' }}
        onTaskCreated={vi.fn()}
      />,
    );
    await act(async () => {
      resolve?.({ proposalFingerprint: oldToken, assessment: 'Stale note', suggestions: [] });
    });
    expect(screen.queryByText('Stale note')).not.toBeInTheDocument();
  });
  it('discards a response when visible titles change while the draft stays the same', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    let oldToken = '';
    state.assess.mockImplementation(({ proposalFingerprint }) => {
      oldToken = proposalFingerprint;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const view = render(
      <DailyPlanningAssessment
        draft={draft}
        proposalToken="titles:before"
        onTaskCreated={vi.fn()}
      />,
    );
    await settle();
    view.rerender(
      <DailyPlanningAssessment
        draft={draft}
        proposalToken="titles:after"
        onTaskCreated={vi.fn()}
      />,
    );
    await act(async () => {
      resolve?.({
        proposalFingerprint: oldToken,
        assessment: 'Old title note',
        suggestions: [suggestion],
      });
    });
    expect(screen.queryByText('Old title note')).not.toBeInTheDocument();
    expect(screen.queryByText(suggestion.title)).not.toBeInTheDocument();
    await settle();
    expect(state.assess).toHaveBeenLastCalledWith(
      expect.objectContaining({ proposalFingerprint: expect.stringContaining('titles:after:') }),
    );
  });
  it('lets the person dismiss a note and a task proposal separately', async () => {
    state.assess.mockImplementation(async ({ proposalFingerprint }) => ({
      proposalFingerprint,
      assessment: 'Keep the open afternoon.',
      suggestions: [suggestion],
    }));
    render(<DailyPlanningAssessment draft={draft} onTaskCreated={vi.fn()} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Athena assessment' }));
    expect(screen.queryByText('Keep the open afternoon.')).not.toBeInTheDocument();
    expect(screen.getByText(suggestion.title)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Prepare release checklist' }));
    expect(screen.queryByText(suggestion.title)).not.toBeInTheDocument();
  });

  it('coalesces edits while a model request is still running', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    let firstToken = '';
    state.assess.mockImplementation(({ proposalFingerprint }) => {
      firstToken = proposalFingerprint;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const view = render(<DailyPlanningAssessment draft={draft} onTaskCreated={vi.fn()} />);
    await settle();
    view.rerender(
      <DailyPlanningAssessment
        draft={{ ...draft, finishAt: '2026-10-07T01:00:00.000Z' }}
        onTaskCreated={vi.fn()}
      />,
    );
    await settle();
    expect(state.assess).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve?.({ proposalFingerprint: firstToken, assessment: 'Stale note', suggestions: [] });
    });
    await settle();
    expect(state.assess).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Stale note')).not.toBeInTheDocument();
  });
  it('shows no placeholder narrative while waiting or after model failure', async () => {
    state.assess.mockRejectedValue(new Error('provider details'));
    render(<DailyPlanningAssessment draft={draft} onTaskCreated={vi.fn()} />);
    expect(screen.queryByText('Athena')).not.toBeInTheDocument();
    await settle();
    expect(screen.queryByText('provider details')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask Athena' })).toBeEnabled();
  });
});
