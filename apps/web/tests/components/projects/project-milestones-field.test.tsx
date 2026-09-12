/**
 * Behavior tests for {@link ProjectMilestonesField} — drafting a Project's checkpoints on the way in.
 *
 * @remarks
 * These are drafts, not records: nothing here talks to the API, so what the cases pin is the shape
 * of the value handed back to the composer. Order is load-bearing — a draft's position in the list
 * becomes its `sort` when the composer creates it — so adding, editing and removing must all leave
 * the remaining drafts where they were.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type DraftMilestone,
  ProjectMilestonesField,
} from '../../../src/components/projects/project-milestones-field';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** A controlled host, so the field behaves as it does inside the composer's draft. */
function Host({ onChange }: { onChange?: (next: readonly DraftMilestone[]) => void }): JSX.Element {
  const [value, setValue] = useState<readonly DraftMilestone[]>([]);
  return (
    <ProjectMilestonesField
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

/** The drafted milestone names, in the order they are rendered. */
function draftNames(): readonly string[] {
  return screen.getAllByLabelText<HTMLInputElement>('Milestone name').map((input) => input.value);
}

/** Draft one milestone through the inline add row. */
function add(name: string): void {
  const field = screen.getByLabelText('New milestone name');
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

describe('ProjectMilestonesField', () => {
  it('appends each drafted milestone in the order it was typed', () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);

    add('Beta');
    add('Launch');

    expect(draftNames()).toEqual(['Beta', 'Launch']);
  });

  it('edits one draft in place without disturbing the others', () => {
    render(<Host />);
    add('Beta');
    add('Launch');

    // Addressed by its own value rather than by index, so the assertion is about that draft.
    fireEvent.change(screen.getByDisplayValue('Beta'), { target: { value: 'Beta cutoff' } });

    expect(draftNames()).toEqual(['Beta cutoff', 'Launch']);
  });

  it('keeps a note against the draft it was typed into', () => {
    render(<Host />);
    add('Beta');

    fireEvent.change(screen.getByLabelText('Beta note'), {
      target: { value: 'All P0s closed.' },
    });

    expect(screen.getByDisplayValue('All P0s closed.')).toBeTruthy();
  });

  it('removes one draft and leaves the rest in order', () => {
    render(<Host />);
    add('Beta');
    add('Launch');
    add('GA');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Launch' }));

    expect(draftNames()).toEqual(['Beta', 'GA']);
  });

  it('starts every draft undated and empty rather than guessing', () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);

    add('Beta');

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Beta', targetDate: null, description: '' }),
    ]);
  });
});
