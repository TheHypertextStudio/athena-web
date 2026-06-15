import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  EntityList,
  EntityListRow,
  RowMeta,
  RowProgress,
} from '../../../src/components/views/EntityListRow';

describe('EntityListRow', () => {
  it('renders a button by default with the title and a focus ring', () => {
    render(<EntityListRow title="Billing revamp" />);
    const row = screen.getByRole('button', { name: 'Billing revamp' });
    expect(row).toHaveAttribute('type', 'button');
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveClass('min-h-(--row-h)', 'px-3', 'focus-visible:ring-1', 'border-b');
    expect(row).not.toHaveAttribute('data-active');
    expect(row).not.toHaveAttribute('data-selected');
  });

  it('calls onActivate on click and on Enter, ignoring other keys (button mode)', () => {
    const onActivate = vi.fn();
    render(<EntityListRow title="Open me" onActivate={onActivate} />);
    const row = screen.getByRole('button', { name: 'Open me' });
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: 'x' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('does not throw on Enter when onActivate is absent', () => {
    render(<EntityListRow title="No handler" />);
    expect(() => {
      fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    }).not.toThrow();
  });

  it('reflects active and selected state with the MD3 selected tone', () => {
    render(<EntityListRow title="Active row" active selected className="row-x" />);
    const row = screen.getByRole('button', { name: 'Active row' });
    expect(row).toHaveAttribute('data-active', '');
    expect(row).toHaveAttribute('data-selected', '');
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(row).toHaveClass('bg-surface-container-highest', 'row-x');
  });

  it('renders the leading, subtitle, meta, and trailing slots', () => {
    render(
      <EntityListRow
        title="Composed"
        leading={<span data-testid="lead">L</span>}
        subtitle="a quiet second line"
        meta={<RowMeta>12 tasks</RowMeta>}
        trailing={<span data-testid="trail">T</span>}
      />,
    );
    expect(screen.getByTestId('lead')).toBeInTheDocument();
    expect(screen.getByText('a quiet second line')).toBeInTheDocument();
    expect(screen.getByText('12 tasks')).toBeInTheDocument();
    expect(screen.getByTestId('trail')).toBeInTheDocument();
  });

  it('omits the optional slots entirely when not provided', () => {
    const { container } = render(<EntityListRow title="Bare" />);
    // Only the title column wrapper is present (no leading/subtitle/meta/trailing spans).
    expect(screen.queryByText('a quiet second line')).not.toBeInTheDocument();
    // The single direct child span is the title column.
    const row = container.querySelector('button');
    expect(row?.querySelectorAll(':scope > span')).toHaveLength(1);
  });

  it('renders an anchor when href is set and does NOT synthesize activation on Enter', () => {
    const onActivate = vi.fn();
    render(<EntityListRow title="Go" href="/orgs/o1/projects/p1" onActivate={onActivate} />);
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('href', '/orgs/o1/projects/p1');
    link.addEventListener('click', (event) => {
      event.preventDefault();
    });
    // Click still activates (e.g. to record selection), Enter is left to the browser's nav.
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('mirrors active state as aria-current and selected as data-selected on a link row', () => {
    render(<EntityListRow title="Current" href="/x" active selected />);
    const link = screen.getByRole('link', { name: 'Current' });
    expect(link).toHaveAttribute('aria-current', 'true');
    expect(link).toHaveAttribute('data-active', '');
    expect(link).toHaveAttribute('data-selected', '');
    expect(link).toHaveClass('bg-surface-container-highest');
  });

  it('uses an explicit aria-label over the title text', () => {
    render(<EntityListRow title={<span>ENG</span>} aria-label="Engineering team" />);
    expect(screen.getByRole('button', { name: 'Engineering team' })).toBeInTheDocument();
  });

  it('hides the trailing slot until hover when revealTrailingOnHover is set', () => {
    render(
      <EntityListRow
        title="Hover actions"
        trailing={<span data-testid="actions">A</span>}
        revealTrailingOnHover
      />,
    );
    const wrapper = screen.getByTestId('actions').parentElement;
    expect(wrapper).toHaveClass('opacity-0', 'group-hover/row:opacity-100');
  });

  it('renders an inert presentational div with no button/link when interactive is false', () => {
    const onActivate = vi.fn();
    render(
      <EntityListRow
        title="Engineering"
        interactive={false}
        onActivate={onActivate}
        aria-label="ENG Engineering"
      />,
    );
    // No focusable control is exposed for a presentational row.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const row = screen.getByLabelText('ENG Engineering');
    expect(row.tagName).toBe('DIV');
    // Keeps the shared layout/density, but drops the interactive affordances.
    expect(row).toHaveClass('min-h-(--row-h)', 'px-3', 'border-b');
    expect(row).not.toHaveClass('cursor-pointer', 'hover:bg-surface-container-high');
    // It is inert: there is nothing to click that would fire activation.
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('renders via a custom render slot (e.g. a router Link)', () => {
    const onActivate = vi.fn();
    render(
      <EntityListRow
        title="Routed"
        href="/dest"
        onActivate={onActivate}
        render={(p) => (
          <a
            data-testid="router-link"
            href={p.href}
            className={p.className}
            onClick={(event) => {
              event.preventDefault();
              p.onClick();
            }}
          >
            {p.children}
          </a>
        )}
      />,
    );
    const link = screen.getByTestId('router-link');
    expect(link).toHaveAttribute('href', '/dest');
    expect(link).toHaveClass('min-h-(--row-h)');
    expect(screen.getByText('Routed')).toBeInTheDocument();
    fireEvent.click(link);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('RowMeta', () => {
  it('renders children inline with a consistent gap', () => {
    render(<RowMeta className="meta-x">hello</RowMeta>);
    const node = screen.getByText('hello');
    expect(node).toHaveClass('flex', 'items-center', 'gap-1.5', 'meta-x');
    expect(node).not.toHaveClass('tabular-nums');
  });

  it('opts into tabular figures for numeric meta', () => {
    render(<RowMeta tabular>42</RowMeta>);
    expect(screen.getByText('42')).toHaveClass('tabular-nums');
  });
});

describe('RowProgress', () => {
  it('renders an accessible progressbar with the rounded clamped value and fill width', () => {
    render(<RowProgress value={61.7} label="Weighted progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Weighted progress' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '62');
    const fill = bar.querySelector('span');
    expect(fill).toHaveStyle({ width: '61.7%' });
    expect(fill).toHaveClass('bg-state-started');
  });

  it('clamps out-of-range values into 0..100', () => {
    const { rerender } = render(<RowProgress value={-20} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    rerender(<RowProgress value={250} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('honors a custom fill color token', () => {
    render(<RowProgress value={50} fillClassName="bg-state-completed" />);
    const fill = screen.getByRole('progressbar').querySelector('span');
    expect(fill).toHaveClass('bg-state-completed');
    expect(fill).not.toHaveClass('bg-state-started');
  });
});

describe('EntityList', () => {
  it('wraps rows in the bordered rounded container with an accessible label', () => {
    render(
      <EntityList aria-label="Projects">
        <EntityListRow title="One" />
        <EntityListRow title="Two" />
      </EntityList>,
    );
    const group = screen.getByRole('group', { name: 'Projects' });
    expect(group).toHaveClass('rounded-xl', 'border', 'border-outline-variant', 'overflow-hidden');
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Two' })).toBeInTheDocument();
  });

  it('merges a custom className onto the container', () => {
    render(<EntityList className="list-x">{null}</EntityList>);
    expect(screen.getByRole('group')).toHaveClass('list-x');
  });
});
