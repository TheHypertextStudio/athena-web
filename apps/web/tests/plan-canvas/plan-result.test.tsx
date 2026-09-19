import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlanCommitOut, PlanDraftOut } from '@docket/work/plan-draft-contract';

import {
  createdCountsText,
  planResultFrom,
  planUndoFailure,
  type PlanResult,
} from '../../src/components/plan-canvas/plan-result';
import { PlanResultLine } from '../../src/components/plan-canvas/plan-result-line';
import { usePlanResult } from '../../src/components/plan-canvas/use-plan-view';
import { UserFacingError } from '../../src/lib/problem';

afterEach(() => {
  cleanup();
});

const COUNTS = { initiatives: 1, projects: 3, tasks: 7, subtasks: 14 };

function commit(overrides: Partial<PlanCommitOut> = {}): PlanCommitOut {
  return {
    plan: {} as PlanDraftOut,
    placed: [
      { ref: 'init', kind: 'initiative', id: 'ini_1', created: true },
      { ref: 't1', kind: 'task', id: 'tsk_1', created: true },
    ] as PlanCommitOut['placed'],
    createdCounts: COUNTS,
    changeSetId: 'cs_1',
    ...overrides,
  };
}

describe('createdCountsText', () => {
  it('counts every kind created, pluralising each by its own count', () => {
    const text = createdCountsText(COUNTS) ?? '';
    expect(text).toMatch(/\b1 initiative\b/);
    expect(text).toMatch(/\b3 projects\b/);
    expect(text).toMatch(/\b7 tasks\b/);
    expect(text).toMatch(/\b14 subtasks\b/);
  });

  it('leaves out every kind the commit created none of', () => {
    const text = createdCountsText({ initiatives: 0, projects: 1, tasks: 0, subtasks: 1 }) ?? '';
    expect(text).not.toMatch(/initiative|\btasks?\b/);
    expect(text).toMatch(/\b1 project\b/);
    expect(text).toMatch(/\b1 subtask\b/);
  });

  it('is null when nothing was created', () => {
    expect(createdCountsText({ initiatives: 0, projects: 0, tasks: 0, subtasks: 0 })).toBeNull();
  });
});

describe('planUndoFailure', () => {
  it('reads each failure by its Problem code, and never echoes the error', () => {
    const gone = planUndoFailure(new UserFacingError('secret', { status: 404, code: 'not_found' }));
    const moved = planUndoFailure(new UserFacingError('secret', { status: 409, code: 'conflict' }));
    const offline = planUndoFailure(new UserFacingError('secret', { status: 0 }));
    const server = planUndoFailure(new UserFacingError('secret', { status: 500 }));
    const causes = new Set([gone, moved, offline, server]);
    expect(causes.size).toBe(4);
    for (const copy of causes) expect(copy).not.toContain('secret');
  });
});

describe('PlanResultLine', () => {
  const result: PlanResult = planResultFrom(commit());

  it('offers Undo on the line a commit leaves and calls it', () => {
    const onUndo = vi.fn();
    render(<PlanResultLine result={result} onUndo={onUndo} onDismiss={vi.fn()} />);
    const line = screen.getByTestId('plan-result');
    expect(line).toHaveAttribute('data-phase', 'created');
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('drops Undo once undone, and while undoing keeps it from a second press', () => {
    const { rerender } = render(
      <PlanResultLine
        result={{ ...result, phase: 'undoing' }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled();
    rerender(
      <PlanResultLine
        result={{ ...result, phase: 'undone' }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('plan-result')).toHaveAttribute('data-phase', 'undone');
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
  });

  it('offers no Undo for a commit that only matched existing records', () => {
    const matched = planResultFrom(
      commit({
        placed: [
          { ref: 'p1', kind: 'project', id: 'prj_1', created: false },
        ] as PlanCommitOut['placed'],
        createdCounts: { initiatives: 0, projects: 0, tasks: 0, subtasks: 0 },
        changeSetId: null,
      }),
    );
    render(<PlanResultLine result={matched} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
  });
});

describe('usePlanResult', () => {
  it('undoes the commit by its change set and settles on undone', async () => {
    const undoCommit = vi.fn(() => Promise.resolve({ ok: true }));
    const { result } = renderHook(() => usePlanResult(undoCommit));
    act(() => {
      result.current.record(commit());
    });
    expect(result.current.result?.phase).toBe('created');
    await act(async () => {
      result.current.undo();
      await Promise.resolve();
    });
    expect(undoCommit).toHaveBeenCalledWith('cs_1');
    expect(result.current.result?.phase).toBe('undone');
    expect(result.current.result?.error).toBeNull();
  });

  it('keeps Undo available with the cause when the undo is refused', async () => {
    const refused = new UserFacingError('x', { status: 409, code: 'conflict' });
    const undoCommit = vi.fn(() => Promise.resolve({ ok: false, error: refused }));
    const { result } = renderHook(() => usePlanResult(undoCommit));
    act(() => {
      result.current.record(commit());
    });
    await act(async () => {
      result.current.undo();
      await Promise.resolve();
    });
    expect(result.current.result?.phase).toBe('created');
    expect(result.current.result?.error).toBe(planUndoFailure(refused));
  });
});
