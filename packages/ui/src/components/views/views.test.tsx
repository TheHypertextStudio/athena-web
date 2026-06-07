import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupHeader } from './GroupHeader';
import { ListCell, ListRow, TaskRow, type TaskRowData } from './ListRow';
import { ListGroup } from './ListGroup';
import { ListSubGroup } from './ListSubGroup';

describe('GroupHeader', () => {
  it('renders the down chevron, label, and count when expanded', () => {
    render(<GroupHeader label="Alpha" expanded count={3} onToggle={() => undefined} />);
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row).toHaveAttribute('data-level', '0');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders the right chevron when collapsed and omits the count when undefined', () => {
    render(<GroupHeader label="Beta" expanded={false} onToggle={() => undefined} />);
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    // No numeric count node when count is undefined.
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('fires onToggle on click', () => {
    const onToggle = vi.fn();
    render(<GroupHeader label="Gamma" expanded onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('row'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it.each(['Enter', ' '])('fires onToggle on the %s key', (key) => {
    const onToggle = vi.fn();
    render(<GroupHeader label="Delta" expanded onToggle={onToggle} />);
    fireEvent.keyDown(screen.getByRole('row'), { key });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated keys', () => {
    const onToggle = vi.fn();
    render(<GroupHeader label="Eps" expanded onToggle={onToggle} />);
    fireEvent.keyDown(screen.getByRole('row'), { key: 'a' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('applies left padding indentation for nested levels and renders decoration', () => {
    render(
      <GroupHeader
        label="Nested"
        expanded
        level={2}
        decoration={<span data-testid="deco">D</span>}
        onToggle={() => undefined}
      />,
    );
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('data-level', '2');
    expect(row).toHaveStyle({ paddingLeft: '3rem' });
    expect(screen.getByTestId('deco')).toBeInTheDocument();
  });
});

describe('ListGroup', () => {
  it('renders a level-0 header delegating to GroupHeader', () => {
    render(
      <ListGroup label="Top" expanded count={2} onToggle={() => undefined} className="lg-x" />,
    );
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('data-level', '0');
    expect(row).toHaveClass('lg-x');
    expect(screen.getByText('Top')).toBeInTheDocument();
  });
});

describe('ListSubGroup', () => {
  it('renders a StatusIcon decoration derived from stateType', () => {
    render(
      <ListSubGroup label="In Progress" expanded stateType="started" onToggle={() => undefined} />,
    );
    expect(screen.getByRole('row')).toHaveAttribute('data-level', '1');
    expect(screen.getByRole('img', { name: 'In Progress' })).toHaveClass('text-state-started');
  });

  it('prefers an explicit decoration over the stateType icon', () => {
    render(
      <ListSubGroup
        label="Custom"
        expanded
        stateType="started"
        decoration={<span data-testid="explicit">X</span>}
        onToggle={() => undefined}
      />,
    );
    expect(screen.getByTestId('explicit')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders no decoration when neither stateType nor decoration is given', () => {
    render(<ListSubGroup label="Plain" expanded onToggle={() => undefined} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Plain')).toBeInTheDocument();
  });
});

describe('ListCell', () => {
  it('renders a gridcell with merged className', () => {
    render(<ListCell className="cell-x">content</ListCell>);
    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveClass('cell-x');
    expect(cell).toHaveTextContent('content');
  });
});

describe('ListRow', () => {
  it('renders defaults (not active, not selected, tabIndex -1)', () => {
    render(<ListRow>r</ListRow>);
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('aria-selected', 'false');
    expect(row).toHaveAttribute('tabindex', '-1');
    expect(row).not.toHaveAttribute('data-active');
  });

  it('reflects active and selected state', () => {
    render(
      <ListRow active selected tabIndex={0} className="row-x">
        r
      </ListRow>,
    );
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('data-active', '');
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).toHaveAttribute('tabindex', '0');
    // active adds `bg-accent`; selected adds `bg-accent/70`; twMerge keeps the last.
    expect(row).toHaveClass('bg-accent/70', 'row-x');
  });

  it('applies only bg-accent when active but not selected', () => {
    render(<ListRow active>r</ListRow>);
    expect(screen.getByRole('row')).toHaveClass('bg-accent');
  });

  it('calls onActivate on click', () => {
    const onActivate = vi.fn();
    render(<ListRow onActivate={onActivate}>r</ListRow>);
    fireEvent.click(screen.getByRole('row'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('calls onActivate on Enter and ignores other keys', () => {
    const onActivate = vi.fn();
    render(<ListRow onActivate={onActivate}>r</ListRow>);
    const row = screen.getByRole('row');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: 'x' });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('does not throw on Enter when onActivate is absent', () => {
    render(<ListRow>r</ListRow>);
    expect(() => {
      fireEvent.keyDown(screen.getByRole('row'), { key: 'Enter' });
    }).not.toThrow();
  });
});

describe('TaskRow', () => {
  const baseTask: TaskRowData = { id: 'T1', title: 'Do thing', stateType: 'started' };

  it('renders the status icon and title with no assignee cell', () => {
    render(<TaskRow task={baseTask} />);
    expect(screen.getByText('Do thing')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'started' })).toBeInTheDocument();
    // status cell + title cell only.
    expect(screen.getAllByRole('gridcell')).toHaveLength(2);
  });

  it('renders the assignee avatar (defaulting to human) when assigneeName is set', () => {
    render(<TaskRow task={{ ...baseTask, assigneeName: 'Ada Lovelace' }} />);
    expect(screen.getByLabelText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(3);
  });

  it('honors an explicit assignee kind and avatar url', () => {
    render(
      <TaskRow
        task={{
          ...baseTask,
          assigneeName: 'Triage Bot',
          assigneeKind: 'agent',
          assigneeAvatarUrl: 'https://example.com/bot.png',
        }}
        active
        selected
        onActivate={() => undefined}
        tabIndex={0}
      />,
    );
    const box = screen.getByLabelText('Triage Bot');
    expect(box.parentElement).toHaveAttribute('data-actor-kind', 'agent');
  });
});
