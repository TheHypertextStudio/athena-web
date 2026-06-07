import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import * as React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ListView, type GroupKey, NO_GROUP_LABEL } from '../../../src/components/views/ListView';
import { TaskRow, type TaskRowData } from '../../../src/components/views/ListRow';

/**
 * jsdom reports zero element sizes; stub them so `@tanstack/react-virtual` mounts the
 * full (small) list. Mirrors the setup in list-view.test.tsx.
 */
const VIEWPORT = 800;
const ROW = 36;
let restoreHeight: (() => void) | undefined;
let restoreWidth: (() => void) | undefined;

beforeAll(() => {
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => ROW,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => VIEWPORT,
  });
  HTMLElement.prototype.getBoundingClientRect = function getRect(): DOMRect {
    return {
      width: VIEWPORT,
      height: VIEWPORT,
      top: 0,
      left: 0,
      bottom: VIEWPORT,
      right: VIEWPORT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
  restoreHeight = () => {
    if (heightDesc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDesc);
  };
  restoreWidth = () => {
    if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDesc);
  };
});

afterAll(() => {
  restoreHeight?.();
  restoreWidth?.();
});

interface MockTask extends TaskRowData {
  projectId: string | null;
  projectName: string | null;
  stateName: string;
}

const TASKS: MockTask[] = [
  {
    id: 'T1',
    title: 'One',
    stateType: 'started',
    stateName: 'In Progress',
    projectId: 'P',
    projectName: 'Proj',
  },
  {
    id: 'T2',
    title: 'Two',
    stateType: 'backlog',
    stateName: 'Backlog',
    projectId: 'P',
    projectName: 'Proj',
  },
  {
    id: 'T3',
    title: 'Three',
    stateType: 'unstarted',
    stateName: 'Todo',
    projectId: null,
    projectName: null,
  },
];

const groupByProject = (task: MockTask): GroupKey | null =>
  task.projectId && task.projectName ? { id: task.projectId, label: task.projectName } : null;

const subGroupByState = (task: MockTask): GroupKey => ({
  id: task.stateType,
  label: task.stateName,
  stateType: task.stateType,
});

describe('ListView — single-level grouping (no subGroupBy)', () => {
  it('renders rows directly under group headers using the __all__ sub-bucket', () => {
    render(
      <ListView<MockTask>
        items={TASKS}
        groupBy={groupByProject}
        getItemKey={(t) => t.id}
        renderRow={(t) => <TaskRow task={t} />}
      />,
    );
    expect(screen.getByText('Proj')).toBeInTheDocument();
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    // No-group bucket still appears for the ungrouped task.
    expect(screen.getByText(NO_GROUP_LABEL)).toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
  });
});

describe('ListView — empty', () => {
  it('renders an empty grid with no rows', () => {
    render(
      <ListView<MockTask>
        items={[]}
        groupBy={groupByProject}
        renderRow={(t) => <TaskRow task={t} />}
        label="Empty"
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Empty' });
    expect(grid).toHaveAttribute('aria-rowcount', '0');
  });
});

describe('ListView — getItemKey fallback', () => {
  it('renders rows using the index-based key when getItemKey is omitted', () => {
    render(
      <ListView<MockTask>
        items={TASKS}
        groupBy={groupByProject}
        subGroupBy={subGroupByState}
        renderRow={(t) => <TaskRow task={t} />}
      />,
    );
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
  });
});

describe('ListView — subGroupBy returning null', () => {
  it('routes a sub-group-less item into the no-group sub-bucket', () => {
    render(
      <ListView<MockTask>
        items={[{ ...TASKS[0]!, id: 'X1', title: 'NoSub' }]}
        groupBy={() => ({ id: 'G', label: 'Group' })}
        subGroupBy={() => null}
        getItemKey={(t) => t.id}
        renderRow={(t) => <TaskRow task={t} />}
      />,
    );
    expect(screen.getByText('Group')).toBeInTheDocument();
    // The synthesized no-group sub-bucket header is present.
    expect(screen.getByText(NO_GROUP_LABEL)).toBeInTheDocument();
    expect(screen.getByText('NoSub')).toBeInTheDocument();
  });
});

describe('ListView — controlled collapse', () => {
  it('reflects the controlled collapsed set and calls onToggle without mutating internal state', () => {
    const onToggle = vi.fn();
    const collapsed = new Set<string>(['P']);
    render(
      <ListView<MockTask>
        items={TASKS}
        groupBy={groupByProject}
        subGroupBy={subGroupByState}
        getItemKey={(t) => t.id}
        collapsed={collapsed}
        onToggle={onToggle}
        renderRow={(t) => <TaskRow task={t} />}
      />,
    );
    // 'P' is collapsed so its rows are hidden.
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.getByText('Proj')).toBeInTheDocument();

    // Clicking the (collapsed) group header calls onToggle but does not change state
    // (the parent owns it), so the row stays hidden.
    fireEvent.click(screen.getByText('Proj').closest('[role="row"]')!);
    expect(onToggle).toHaveBeenCalledWith('P');
    expect(screen.queryByText('One')).not.toBeInTheDocument();
  });

  it('toggles a sub-group via its header in controlled mode', () => {
    const onToggle = vi.fn();
    render(
      <ListView<MockTask>
        items={TASKS}
        groupBy={groupByProject}
        subGroupBy={subGroupByState}
        getItemKey={(t) => t.id}
        collapsed={new Set()}
        onToggle={onToggle}
        renderRow={(t) => <TaskRow task={t} />}
      />,
    );
    fireEvent.click(screen.getByText('In Progress').closest('[role="row"]')!);
    expect(onToggle).toHaveBeenCalledWith('P/started');
  });
});

describe('ListView — uncontrolled collapse with defaultCollapsed', () => {
  it('starts with the default-collapsed group hidden, then expands it on click', () => {
    render(
      <ListView<MockTask>
        items={TASKS}
        groupBy={groupByProject}
        subGroupBy={subGroupByState}
        getItemKey={(t) => t.id}
        defaultCollapsed={['P']}
        renderRow={(t) => <TaskRow task={t} />}
      />,
    );
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Proj').closest('[role="row"]')!);
    expect(screen.getByText('One')).toBeInTheDocument();
  });
});

describe('ListView — keyboard navigation + activation', () => {
  function renderForKeyboard(onActivateItem?: (t: MockTask) => void): HTMLElement {
    render(
      <ListView<MockTask>
        items={TASKS}
        groupBy={groupByProject}
        subGroupBy={subGroupByState}
        getItemKey={(t) => t.id}
        onActivateItem={onActivateItem}
        renderRow={(t, ctx) => <TaskRow task={t} active={ctx.active} onActivate={ctx.onActivate} />}
      />,
    );
    return screen.getByRole('grid', { name: 'List' });
  }

  it('ArrowDown then Enter on a group header toggles the group collapsed', () => {
    const grid = renderForKeyboard();
    expect(screen.getByText('One')).toBeInTheDocument();
    // First row is the 'Proj' group header.
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(screen.queryByText('One')).not.toBeInTheDocument();
  });

  it('Enter on a sub-group header toggles the sub-group, and on a data row activates the item', () => {
    const onActivateItem = vi.fn();
    const grid = renderForKeyboard(onActivateItem);
    // Row 0 group, row 1 subgroup "In Progress", row 2 data row "One".
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> 0 (group)
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> 1 (subgroup)
    fireEvent.keyDown(grid, { key: 'Enter' }); // toggles subgroup
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    // Re-expand and activate the data row.
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(screen.getByText('One')).toBeInTheDocument();
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> 2 (data row)
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onActivateItem).toHaveBeenCalledTimes(1);
    expect(onActivateItem.mock.calls[0]![0]).toMatchObject({ id: 'T1' });
  });

  it('supports Home, End, ArrowUp, and Escape navigation', () => {
    const grid = renderForKeyboard();
    fireEvent.keyDown(grid, { key: 'End' });
    fireEvent.keyDown(grid, { key: 'Home' });
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    fireEvent.keyDown(grid, { key: 'Escape' });
    // Escape clears the active row; the grid stays mounted.
    expect(grid).toBeInTheDocument();
  });

  it('clicking a data row activates the item via onActivate', () => {
    const onActivateItem = vi.fn();
    renderForKeyboard(onActivateItem);
    fireEvent.click(screen.getByText('One').closest('[role="row"]')!);
    expect(onActivateItem).toHaveBeenCalledTimes(1);
  });
});

describe('ListView — collapse keeps active index valid', () => {
  // Drives the rowCount-shrink effect in useListKeyboard via ListView re-render.
  it('clamps the active index when rows shrink after collapse', () => {
    function Harness(): React.JSX.Element {
      const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setCollapsed(new Set(['P']));
            }}
          >
            collapse
          </button>
          <ListView<MockTask>
            items={TASKS}
            groupBy={groupByProject}
            subGroupBy={subGroupByState}
            getItemKey={(t) => t.id}
            collapsed={collapsed}
            renderRow={(t, ctx) => (
              <TaskRow task={t} active={ctx.active} onActivate={ctx.onActivate} />
            )}
          />
        </>
      );
    }
    render(<Harness />);
    const grid = screen.getByRole('grid', { name: 'List' });
    // Move active to the last row.
    fireEvent.keyDown(grid, { key: 'End' });
    // Collapse the big group; rowCount shrinks and the effect clamps the active index.
    fireEvent.click(screen.getByText('collapse'));
    expect(within(grid).queryByText('One')).not.toBeInTheDocument();
  });
});
