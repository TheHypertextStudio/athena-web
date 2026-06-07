import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StatusIcon, type WorkflowStateType } from '../atoms/StatusIcon';
import { ListView, type GroupKey } from './ListView';
import { TaskRow, type TaskRowData } from './ListRow';

/**
 * jsdom reports zero element sizes, which would make `@tanstack/react-virtual` render no
 * rows. Stub `offsetHeight`/`offsetWidth` and `getBoundingClientRect` so the scroll element
 * and measured rows report a real size and the virtualizer mounts the full (small) list.
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

/** A mock task shape: a {@link TaskRowData} plus its project + state metadata for grouping. */
interface MockTask extends TaskRowData {
  projectId: string | null;
  projectName: string | null;
  stateName: string;
}

const PROJECT_ALPHA = 'PRJ_alpha';
const PROJECT_ALPHA_NAME = 'Alpha';

const TASKS: MockTask[] = [
  {
    id: 'T1',
    title: 'Wire up the API',
    stateType: 'started',
    stateName: 'In Progress',
    projectId: PROJECT_ALPHA,
    projectName: PROJECT_ALPHA_NAME,
  },
  {
    id: 'T2',
    title: 'Draft the schema',
    stateType: 'backlog',
    stateName: 'Backlog',
    projectId: PROJECT_ALPHA,
    projectName: PROJECT_ALPHA_NAME,
  },
  {
    id: 'T3',
    title: 'Untriaged bug report',
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

function renderListView(): ReturnType<typeof render> {
  return render(
    <ListView<MockTask>
      items={TASKS}
      groupBy={groupByProject}
      subGroupBy={subGroupByState}
      getItemKey={(task) => task.id}
      renderRow={(task, ctx) => (
        <TaskRow task={task} active={ctx.active} onActivate={ctx.onActivate} />
      )}
    />,
  );
}

describe('ListView', () => {
  it('renders group headers, sub-group headers, and data rows', () => {
    renderListView();

    expect(screen.getByRole('grid', { name: 'List' })).toBeInTheDocument();
    // Top-level group header for the project.
    expect(screen.getByText(PROJECT_ALPHA_NAME)).toBeInTheDocument();
    // Sub-group headers by workflow state.
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Backlog')).toBeInTheDocument();
    // Data rows.
    expect(screen.getByText('Wire up the API')).toBeInTheDocument();
    expect(screen.getByText('Draft the schema')).toBeInTheDocument();
  });

  it("places a task with no project under the 'No project / Triage' bucket", () => {
    renderListView();

    expect(screen.getByText('No project / Triage')).toBeInTheDocument();
    expect(screen.getByText('Untriaged bug report')).toBeInTheDocument();
  });

  it("hides a group's rows when the group header is collapsed", () => {
    renderListView();

    expect(screen.getByText('Wire up the API')).toBeInTheDocument();

    // The project group header is a row with aria-expanded; click it to collapse.
    const groupHeader = screen.getByText(PROJECT_ALPHA_NAME).closest('[role="row"]');
    expect(groupHeader).not.toBeNull();
    const header = groupHeader as HTMLElement;
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);

    expect(header).toHaveAttribute('aria-expanded', 'false');
    // The collapsed group's rows and sub-group headers are gone.
    expect(screen.queryByText('Wire up the API')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft the schema')).not.toBeInTheDocument();
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument();
    // The no-project bucket and its row remain.
    expect(screen.getByText('Untriaged bug report')).toBeInTheDocument();
  });
});

describe('StatusIcon', () => {
  it('uses the state-started token class for a started-type state', () => {
    render(<StatusIcon type="started" label="In Progress" />);
    const icon = screen.getByRole('img', { name: 'In Progress' });
    expect(icon).toHaveClass('text-state-started');
    expect(icon).toHaveAttribute('data-state-type', 'started');
  });

  it('uses the state-backlog token class for a backlog-type state', () => {
    render(<StatusIcon type="backlog" label="Backlog" />);
    const icon = screen.getByRole('img', { name: 'Backlog' });
    expect(icon).toHaveClass('text-state-backlog');
    expect(icon).toHaveAttribute('data-state-type', 'backlog');
  });

  it('keys color off the type, not the free-form state name', () => {
    // Two different free-form names mapping to the same type get the same token class.
    const types: WorkflowStateType[] = ['started', 'started'];
    const { container } = render(
      <div>
        {types.map((t, i) => (
          <StatusIcon key={`${t}-${String(i)}`} type={t} label={`custom-${String(i)}`} />
        ))}
      </div>,
    );
    const icons = within(container).getAllByRole('img');
    for (const icon of icons) {
      expect(icon).toHaveClass('text-state-started');
    }
  });
});
