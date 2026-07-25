import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EntityListRow } from '../../../src/components/views/EntityListRow';
import { ListRow } from '../../../src/components/views/ListRow';
import { type DragSource, dragSourceProps } from '../../../src/lib/draggable';

const SOURCE: DragSource = { onDragStart: vi.fn() };

describe('dragSourceProps', () => {
  it('returns nothing when the row has no drag source', () => {
    expect(dragSourceProps(undefined)).toBeUndefined();
  });

  it('returns nothing for a row the viewer may not drag', () => {
    expect(dragSourceProps({ ...SOURCE, enabled: false })).toBeUndefined();
  });

  it('suppresses text selection so the gesture never paints a stray highlight', () => {
    expect(dragSourceProps(SOURCE)?.className).toContain('select-none');
  });

  it('shows the grabbing cursor only while the pointer is held, keeping click-to-open honest', () => {
    const className = dragSourceProps(SOURCE)?.className ?? '';
    expect(className).toContain('active:cursor-grabbing');
    expect(className).not.toContain('cursor-grab ');
  });

  it('omits onDragEnd when the source does not need cleanup', () => {
    expect(dragSourceProps(SOURCE)).not.toHaveProperty('onDragEnd');
  });
});

describe('ListRow drag source', () => {
  it('is not draggable by default', () => {
    render(<ListRow>cells</ListRow>);
    expect(screen.getByRole('row')).not.toHaveAttribute('draggable');
  });

  it('makes the whole row draggable and unselectable when given a source', () => {
    render(<ListRow drag={SOURCE}>cells</ListRow>);
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('draggable', 'true');
    expect(row.className).toContain('select-none');
  });
});

describe('EntityListRow drag source', () => {
  it('applies to the default button row', () => {
    render(<EntityListRow title="Billing revamp" drag={SOURCE} />);
    const row = screen.getByRole('button');
    expect(row).toHaveAttribute('draggable', 'true');
    expect(row.className).toContain('select-none');
  });

  it('applies to the link row', () => {
    render(<EntityListRow title="Billing revamp" href="/p/1" drag={SOURCE} />);
    const row = screen.getByRole('link');
    expect(row).toHaveAttribute('draggable', 'true');
  });

  it('applies to an inert row — a row with no destination is still draggable', () => {
    render(
      <EntityListRow title="Platform" interactive={false} drag={SOURCE} aria-label="Platform" />,
    );
    expect(screen.getByLabelText('Platform')).toHaveAttribute('draggable', 'true');
  });

  it('hands drag props to a custom render slot so router links stay draggable', () => {
    const render_ = vi.fn(() => <div data-testid="custom" />);
    render(<EntityListRow title="Billing revamp" href="/p/1" render={render_} drag={SOURCE} />);
    expect(render_).toHaveBeenCalledWith(
      expect.objectContaining({ draggable: true, onDragStart: expect.any(Function) }),
    );
  });

  it('leaves a row without a source undraggable', () => {
    render(<EntityListRow title="Billing revamp" />);
    expect(screen.getByRole('button')).not.toHaveAttribute('draggable');
  });
});
