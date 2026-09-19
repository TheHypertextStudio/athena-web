/**
 * Behavior tests for the proposal hover-highlight context.
 *
 * @remarks
 * Pins {@link ProposalHighlightProvider}'s default/set/clear contract and
 * {@link taskIdsFromInput}'s parsing of a raw proposal tool input's `taskId`/`taskIds` fields.
 */
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen } from '@testing-library/react';
import { type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ProposalHighlightProvider,
  taskIdsFromInput,
  useHighlightedIds,
  useHighlightHandlers,
  useSetHighlightedIds,
} from '../../src/components/athena/proposal-highlight';

/** Reads the current highlight set and exposes controls to set/clear it. */
function Probe(): JSX.Element {
  const ids = useHighlightedIds();
  const setIds = useSetHighlightedIds();
  return (
    <div>
      <span data-testid="ids">{Array.from(ids).join(',')}</span>
      <button
        type="button"
        onClick={() => {
          setIds(new Set(['task_1', 'task_2']));
        }}
      >
        set
      </button>
      <button
        type="button"
        onClick={() => {
          setIds(new Set());
        }}
      >
        clear
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('ProposalHighlightProvider', () => {
  it('defaults to an empty highlight set', () => {
    render(
      <ProposalHighlightProvider>
        <Probe />
      </ProposalHighlightProvider>,
    );
    expect(screen.getByTestId('ids')).toHaveTextContent('');
  });

  it('sets and then clears the highlighted ids', () => {
    render(
      <ProposalHighlightProvider>
        <Probe />
      </ProposalHighlightProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'set' }).click();
    });
    expect(screen.getByTestId('ids')).toHaveTextContent('task_1,task_2');

    act(() => {
      screen.getByRole('button', { name: 'clear' }).click();
    });
    expect(screen.getByTestId('ids')).toHaveTextContent('');
  });
});

describe('taskIdsFromInput', () => {
  it('returns an empty set for a missing or empty input', () => {
    expect(taskIdsFromInput(undefined).size).toBe(0);
    expect(taskIdsFromInput(null).size).toBe(0);
    expect(taskIdsFromInput({}).size).toBe(0);
  });

  it('parses a single taskId', () => {
    const ids = taskIdsFromInput({ taskId: 'task_1' });
    expect(Array.from(ids)).toEqual(['task_1']);
  });

  it('parses a batch taskIds array', () => {
    const ids = taskIdsFromInput({ taskIds: ['task_1', 'task_2'] });
    expect(Array.from(ids).sort()).toEqual(['task_1', 'task_2']);
  });

  it('ignores non-string entries and combines taskId with taskIds', () => {
    const ids = taskIdsFromInput({ taskId: 'task_1', taskIds: ['task_2', 42, null] });
    expect(Array.from(ids).sort()).toEqual(['task_1', 'task_2']);
  });
});

/** Exercises the pointer + focus pair through a probe wired into the same provider. */
function HandlersProbe({ targetIds }: { readonly targetIds: ReadonlySet<string> }): JSX.Element {
  const ids = useHighlightedIds();
  const handlers = useHighlightHandlers(targetIds);
  return (
    <div>
      <span data-testid="ids">{Array.from(ids).join(',')}</span>
      <button
        type="button"
        onMouseEnter={handlers.onPointerEnter}
        onMouseLeave={handlers.onPointerLeave}
      >
        hover target
      </button>
      <button type="button" onFocus={handlers.onFocus} onBlur={handlers.onBlur}>
        focus target
      </button>
    </div>
  );
}

describe('useHighlightHandlers', () => {
  it('mirrors pointer hover and keyboard focus onto the same highlight set', () => {
    render(
      <ProposalHighlightProvider>
        <HandlersProbe targetIds={new Set(['task_1'])} />
      </ProposalHighlightProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'focus target' }).focus();
    });
    expect(screen.getByTestId('ids')).toHaveTextContent('task_1');

    act(() => {
      screen.getByRole('button', { name: 'focus target' }).blur();
    });
    expect(screen.getByTestId('ids')).toHaveTextContent('');
  });

  it('never highlights when the target set is empty', () => {
    render(
      <ProposalHighlightProvider>
        <HandlersProbe targetIds={new Set()} />
      </ProposalHighlightProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'focus target' }).focus();
    });
    expect(screen.getByTestId('ids')).toHaveTextContent('');
  });
});
