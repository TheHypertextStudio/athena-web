/**
 * A composer interrupted by navigation: the provider closes it and leaves a pointer to its draft
 * in this tab's session, and the pointer is read back once for the same kind only.
 */
import { ContextProvider } from '@docket/ui/components';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { location } = vi.hoisted(() => ({ location: { pathname: '/orgs/alpha/tasks' } }));

// The pathname is the only fact the provider reads; the harness moves it and re-renders.
vi.mock('../../src/lib/app-location', () => ({
  useAppPathname: () => location.pathname,
}));

import {
  CreateObjectProvider,
  useCreateObject,
} from '../../src/components/create-object/create-object-provider';
import {
  INTERRUPTED_DRAFT_STORAGE_KEY,
  clearInterruptedDraft,
  peekInterruptedDraft,
  readInterruptedDraft,
  writeInterruptedDraft,
} from '../../src/components/create-object/interrupted-draft';

const ORG_ID = '01HZX5K3QJ9F8B7C6D5E4F3G2H';

/** Open a task composer, report its draft, and show whether a request is open. */
function Probe(): JSX.Element {
  const { request, openCreate, setActiveDraftId } = useCreateObject();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          openCreate({ kind: 'task', sameWorkspaceCompletion: 'stay' });
        }}
      >
        Open task
      </button>
      <button
        type="button"
        onClick={() => {
          setActiveDraftId('draft_9');
        }}
      >
        Report draft
      </button>
      <output data-testid="request-kind">{request?.kind ?? 'closed'}</output>
    </>
  );
}

function Tree(): JSX.Element {
  return (
    <ContextProvider initialContext={ORG_ID}>
      <CreateObjectProvider>
        <Probe />
      </CreateObjectProvider>
    </ContextProvider>
  );
}

/** The stored pointer, parsed, or null. */
function storedPointer(): unknown {
  const raw = window.sessionStorage.getItem(INTERRUPTED_DRAFT_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  window.sessionStorage.clear();
  location.pathname = '/orgs/alpha/tasks';
});

afterEach(() => {
  cleanup();
});

describe('CreateObjectProvider — navigation closes the composer', () => {
  it('writes the interrupted pointer and closes when the pathname changes', () => {
    const { rerender } = render(<Tree />);
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Report draft' }));
    expect(screen.getByTestId('request-kind')).toHaveTextContent('task');

    location.pathname = '/orgs/alpha/projects';
    rerender(<Tree />);

    expect(screen.getByTestId('request-kind')).toHaveTextContent('closed');
    expect(storedPointer()).toEqual({ kind: 'task', draftId: 'draft_9' });
  });

  it('closes without a pointer when the composer had not saved a draft', () => {
    const { rerender } = render(<Tree />);
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }));

    location.pathname = '/orgs/alpha/projects';
    rerender(<Tree />);

    expect(screen.getByTestId('request-kind')).toHaveTextContent('closed');
    expect(storedPointer()).toBeNull();
  });

  it('leaves a closed request alone when the pathname changes', () => {
    const { rerender } = render(<Tree />);

    location.pathname = '/orgs/alpha/projects';
    rerender(<Tree />);

    expect(screen.getByTestId('request-kind')).toHaveTextContent('closed');
    expect(storedPointer()).toBeNull();
  });
});

describe('interrupted draft pointer', () => {
  it('is read back once for the same kind and left for another', () => {
    writeInterruptedDraft('task', 'draft_3');

    expect(peekInterruptedDraft('project')).toBeNull();
    expect(readInterruptedDraft('project')).toBeNull();
    expect(storedPointer()).toEqual({ kind: 'task', draftId: 'draft_3' });

    expect(readInterruptedDraft('task')).toBe('draft_3');
    expect(readInterruptedDraft('task')).toBeNull();
    expect(storedPointer()).toBeNull();
  });

  it('ignores a null draft id and unreadable storage', () => {
    writeInterruptedDraft('task', null);
    expect(storedPointer()).toBeNull();

    window.sessionStorage.setItem(INTERRUPTED_DRAFT_STORAGE_KEY, 'not json');
    expect(peekInterruptedDraft('task')).toBeNull();

    window.sessionStorage.setItem(INTERRUPTED_DRAFT_STORAGE_KEY, JSON.stringify({ kind: 'x' }));
    expect(peekInterruptedDraft('task')).toBeNull();
  });

  it('clears only a pointer of the named kind', () => {
    writeInterruptedDraft('program', 'draft_5');
    clearInterruptedDraft('task');
    expect(storedPointer()).toEqual({ kind: 'program', draftId: 'draft_5' });
    clearInterruptedDraft('program');
    expect(storedPointer()).toBeNull();
  });
});
