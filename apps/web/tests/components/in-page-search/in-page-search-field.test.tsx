import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type JSX, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InPageSearchField } from '@/components/in-page-search/in-page-search-field';

afterEach(cleanup);

interface FixtureProps {
  readonly initialValue?: string;
  readonly resultCount?: number;
  readonly pending?: boolean;
  readonly onEscapeEmpty?: () => void;
}

function Fixture({
  initialValue = '',
  resultCount = 3,
  pending = false,
  onEscapeEmpty = (): void => undefined,
}: FixtureProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <InPageSearchField
      inputRef={inputRef}
      value={value}
      onValueChange={setValue}
      onEscapeEmpty={onEscapeEmpty}
      label="Search tasks"
      placeholder="Search every task"
      resultCount={resultCount}
      pending={pending}
    />
  );
}

describe('InPageSearchField', () => {
  it('updates the controlled query when a person types', () => {
    render(<Fixture />);
    const field = screen.getByRole('searchbox', { name: 'Search tasks' });

    fireEvent.change(field, { target: { value: 'offscreen task' } });

    expect(field).toHaveValue('offscreen task');
  });

  it('shows a clear action only for a non-empty query', () => {
    render(<Fixture initialValue="needle" />);
    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();

    fireEvent.click(clear);

    const field = screen.getByRole('searchbox', { name: 'Search tasks' });
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('clears a query on Escape before restoring prior focus', () => {
    const onEscapeEmpty = vi.fn();
    render(<Fixture initialValue="needle" onEscapeEmpty={onEscapeEmpty} />);
    const field = screen.getByRole('searchbox', { name: 'Search tasks' });

    fireEvent.keyDown(field, { key: 'Escape' });

    expect(field).toHaveValue('');
    expect(onEscapeEmpty).not.toHaveBeenCalled();
  });

  it('restores prior focus when Escape is pressed with an empty query', () => {
    const onEscapeEmpty = vi.fn();
    render(<Fixture onEscapeEmpty={onEscapeEmpty} />);

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search tasks' }), { key: 'Escape' });

    expect(onEscapeEmpty).toHaveBeenCalledOnce();
  });

  it('announces the settled result count and preserves it while work is pending', () => {
    render(<Fixture resultCount={7} pending />);

    expect(screen.getByRole('status')).toHaveTextContent('7 results');
    expect(screen.getByRole('search', { name: 'Search tasks' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByText(/Ctrl F|⌘F/)).toBeTruthy();
  });
});
