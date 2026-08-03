import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Column } from '../../../src/components/views/entity-table-columns';
import { EntityTableRow } from '../../../src/components/views/entity-table-row';
import { EntityListRow } from '../../../src/components/views/EntityListRow';
import { ListRow } from '../../../src/components/views/ListRow';
import { type DragSource, dragSourceProps } from '../../../src/lib/draggable';

const SOURCE: DragSource = { onDragStart: vi.fn() };
const SOURCE_WITH_CLEANUP: DragSource = { onDragStart: vi.fn(), onDragEnd: vi.fn() };

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

  it('hands onDragEnd to a custom render slot when the source needs cleanup', () => {
    const render_ = vi.fn(() => <div data-testid="custom" />);
    render(
      <EntityListRow
        title="Billing revamp"
        href="/p/1"
        render={render_}
        drag={SOURCE_WITH_CLEANUP}
      />,
    );
    expect(render_).toHaveBeenCalledWith(
      expect.objectContaining({ onDragEnd: SOURCE_WITH_CLEANUP.onDragEnd }),
    );
  });

  it('leaves a row without a source undraggable', () => {
    render(<EntityListRow title="Billing revamp" />);
    expect(screen.getByRole('button')).not.toHaveAttribute('draggable');
  });
});

describe('EntityTableRow drag source', () => {
  const row = { id: 'r1', name: 'Billing revamp' };
  const columns: Column<typeof row>[] = [
    { key: 'name', header: 'Name', flex: true, render: (r) => r.name },
  ];

  it('applies drag props to the default button row', () => {
    render(
      <EntityTableRow columns={columns} row={row} active={false} selected={false} drag={SOURCE} />,
    );
    const tableRow = screen.getByRole('row');
    expect(tableRow).toHaveAttribute('draggable', 'true');
  });

  it('applies drag props (including onDragEnd) to the plain link row', () => {
    render(
      <EntityTableRow
        columns={columns}
        row={row}
        active={false}
        selected={false}
        href="/p/1"
        drag={SOURCE_WITH_CLEANUP}
      />,
    );
    const tableRow = screen.getByRole('row');
    expect(tableRow).toHaveAttribute('draggable', 'true');
  });

  it('omits onDragEnd from a custom renderRowLink slot when the source needs no cleanup', () => {
    const renderRowLink = vi.fn(() => <div data-testid="custom-row" />);
    render(
      <EntityTableRow
        columns={columns}
        row={row}
        active={false}
        selected={false}
        href="/p/1"
        renderRowLink={renderRowLink}
        drag={SOURCE}
      />,
    );
    expect(renderRowLink).toHaveBeenCalledWith(
      expect.not.objectContaining({ onDragEnd: expect.anything() }),
    );
  });

  it('hands drag props (including onDragEnd) to a custom renderRowLink slot', () => {
    const renderRowLink = vi.fn(() => <div data-testid="custom-row" />);
    render(
      <EntityTableRow
        columns={columns}
        row={row}
        active={false}
        selected={false}
        href="/p/1"
        renderRowLink={renderRowLink}
        drag={SOURCE_WITH_CLEANUP}
      />,
    );
    expect(renderRowLink).toHaveBeenCalledWith(
      expect.objectContaining({
        draggable: true,
        onDragStart: expect.any(Function),
        onDragEnd: SOURCE_WITH_CLEANUP.onDragEnd,
      }),
    );
  });
});
