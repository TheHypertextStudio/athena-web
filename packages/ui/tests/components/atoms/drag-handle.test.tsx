import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DragHandle } from '../../../src/components/atoms/DragHandle';

describe('DragHandle', () => {
  it('is a button that never submits the form around it', () => {
    render(<DragHandle aria-label="Reorder Triage" />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('stays a button even when a caller spreads another type onto it', () => {
    render(<DragHandle aria-label="Reorder Triage" type="submit" />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('rests invisible yet stays in the document and in tab order', async () => {
    const user = userEvent.setup();
    render(<DragHandle aria-label="Reorder Triage" />);
    const handle = screen.getByRole('button');

    expect(handle.className).toContain('opacity-0');
    expect(handle.className).not.toContain('hidden');
    expect(handle).not.toHaveAttribute('tabindex', '-1');

    await user.tab();
    expect(handle).toHaveFocus();
  });

  it('surfaces on row hover, on focus, and while its row is held', () => {
    render(<DragHandle aria-label="Reorder Triage" />);
    const className = screen.getByRole('button').className;

    expect(className).toContain('group-hover/row:opacity-100');
    expect(className).toContain('focus-visible:opacity-100');
    expect(className).toContain('aria-pressed:opacity-100');
  });

  it('grows to a 40px target on a coarse pointer, where there is no hover to reveal it', () => {
    render(<DragHandle aria-label="Reorder Triage" />);
    const className = screen.getByRole('button').className;

    expect(className).toContain('pointer-coarse:size-10');
    expect(className).toContain('pointer-coarse:opacity-100');
  });

  it('merges classes the caller adds', () => {
    render(<DragHandle aria-label="Reorder Triage" className="ml-1" />);
    expect(screen.getByRole('button').className).toContain('ml-1');
  });

  it('forwards the handlers and state a reorder binding hands it', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DragHandle aria-label="Reorder Triage" aria-pressed onClick={onClick} />);
    const handle = screen.getByRole('button');

    expect(handle).toHaveAttribute('aria-pressed', 'true');
    await user.click(handle);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('carries a glyph that is invisible to assistive tech, since the label speaks for it', () => {
    render(<DragHandle aria-label="Reorder Triage" />);
    const glyph = screen.getByRole('button').querySelector('svg');

    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });
});
