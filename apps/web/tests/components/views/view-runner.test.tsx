/**
 * Regression coverage for {@link ViewRunner}'s handling of a live grouping-field switch — the
 * edge case where a viewer has an active "Group by" selection and picks a *different* field
 * instead (e.g. Project → Program).
 *
 * @remarks
 * {@link import('../../../src/components/views/apply-view').applyView}'s synthesized "no value"
 * bucket uses one shared sentinel id (`EMPTY_GROUP_ID`) for *every* groupable field, and
 * `@docket/ui`'s `ListView` keys its expand/collapse state by bucket id, persisting it across
 * re-renders by default. Without a fix, collapsing one field's empty bucket (e.g. "No project")
 * and then re-grouping by a different field that also has an empty bucket (e.g. "No program")
 * would render the new field's bucket pre-collapsed purely because the two buckets happen to
 * share the same literal id — a viewer would read that as "grouping silently hid my tasks",
 * exactly the failure mode this test pins shut.
 */
import '@testing-library/jest-dom/vitest';

import {
  DEFAULT_WORK_STATUSES,
  OrganizationId,
  ProjectId,
  TaskId,
  TeamId,
  type TaskOut,
} from '@docket/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ViewState } from '../../../src/components/views/field-catalog';
import { buildTaskCatalog } from '../../../src/components/views/task-catalog';
import { ViewRunner } from '../../../src/components/views/view-runner';
import { assertDefined } from '@docket/test-utils';
import { InPageSearchProvider } from '../../../src/components/in-page-search/in-page-search-provider';

/**
 * jsdom reports zero element sizes; stub them so `@tanstack/react-virtual` (inside `ListView`)
 * mounts the full (small) list instead of virtualizing everything away. Mirrors the setup in
 * `packages/ui/tests/components/views/list-view-edge.test.tsx`.
 */
const VIEWPORT = 800;
let restoreHeight: (() => void) | undefined;
let restoreWidth: (() => void) | undefined;

beforeAll(() => {
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 40,
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
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
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

const ORG_ID = '01HZZZ0000000000000000000G';
const TEAM_ID = '01HZZZ0000000000000000000T';
const PROJECT_ID = '01HZZZ0000000000000000PRJT';
const TASK_WITH_PROJECT = '01HZZZ0000000000000000T001';
const TASK_BARE = '01HZZZ0000000000000000T002';

const catalog = buildTaskCatalog({
  statuses: DEFAULT_WORK_STATUSES.task,
  projectLabel: 'Project',
  programLabel: 'Program',
  resolveProject: (id) => id,
  resolveProgram: (id) => id,
  resolveAssignee: (id) => id,
  assigneeOptions: () => [],
  projectOptions: () => [],
  programOptions: () => [],
});

/** A minimal task fixture: `TASK_WITH_PROJECT` carries a project (and no program); `TASK_BARE`
 * carries neither, so it lands in *every* field's synthesized empty bucket. */
function task(id: string, title: string, withProject: boolean): TaskOut {
  return {
    labels: [],
    id: TaskId.parse(id),
    organizationId: OrganizationId.parse(ORG_ID),
    teamId: TeamId.parse(TEAM_ID),
    title,
    state: 'todo',
    priority: 'none',
    ...(withProject ? { projectId: ProjectId.parse(PROJECT_ID) } : {}),
    provenance: { source: 'native' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const TASKS: readonly TaskOut[] = [
  task(TASK_WITH_PROJECT, 'Has a project', true),
  task(TASK_BARE, 'Belongs nowhere', false),
];

/** ActorId branding is irrelevant here; `ViewRunner` never dereferences an unset assignee. */
function resolveActor(): null {
  return null;
}

function renderRunner(state: ViewState): ReturnType<typeof render> {
  return render(runner(state));
}

function runner(state: ViewState): React.JSX.Element {
  return (
    <InPageSearchProvider>
      <ViewRunner
        tasks={TASKS}
        state={state}
        catalog={catalog}
        resolveActor={resolveActor}
        label="View"
        onOpenTask={() => undefined}
      />
    </InPageSearchProvider>
  );
}

describe('ViewRunner — switching the active grouping field', () => {
  it('does not carry a collapsed empty bucket over to a different grouping field', () => {
    const byProject: ViewState = { filters: [], groupBy: { field: 'projectId' }, sort: [] };
    const { rerender } = renderRunner(byProject);

    // Grouped by Project, "Belongs nowhere" sits in the synthesized "No project" bucket.
    expect(screen.getByText('No project')).toBeInTheDocument();
    expect(screen.getByText('Belongs nowhere')).toBeInTheDocument();

    // Collapse the "No project" bucket.
    fireEvent.click(assertDefined(screen.getByText('No project').closest('[role="row"]')));
    expect(screen.queryByText('Belongs nowhere')).not.toBeInTheDocument();

    // Switch the active grouping to a *different* field whose empty bucket the viewer never
    // touched. Both fixture tasks lack a program, so they both land in "No program".
    const byProgram: ViewState = { filters: [], groupBy: { field: 'programId' }, sort: [] };
    rerender(runner(byProgram));

    // "No program" must start expanded — the collapse decision belonged to Project's bucket, not
    // Program's, even though both buckets share the engine's synthesized empty-bucket id.
    const noProgramHeader = screen.getByText('No program').closest('[role="row"]');
    expect(noProgramHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Belongs nowhere')).toBeInTheDocument();
    expect(screen.getByText('Has a project')).toBeInTheDocument();
  });

  it('keeps a still-active grouping field expanded across an unrelated re-render', () => {
    // Sanity check for the fix's remount strategy: re-rendering with the *same* grouping field
    // must not itself reset a deliberate collapse (only a field *change* should reset it).
    const byProject: ViewState = { filters: [], groupBy: { field: 'projectId' }, sort: [] };
    const { rerender } = renderRunner(byProject);

    fireEvent.click(assertDefined(screen.getByText('No project').closest('[role="row"]')));
    expect(screen.queryByText('Belongs nowhere')).not.toBeInTheDocument();

    // Re-render with the identical state (e.g. a parent re-render triggered by unrelated props).
    rerender(runner({ ...byProject }));

    expect(screen.queryByText('Belongs nowhere')).not.toBeInTheDocument();
  });

  it('composes transient complete-corpus search before the authored view state', () => {
    const state: ViewState = { filters: [], groupBy: { field: 'projectId' }, sort: [] };
    renderRunner(state);

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    const field = screen.getByRole('searchbox', { name: 'Search View' });
    fireEvent.change(field, { target: { value: 'belongs nowhere' } });

    expect(screen.getByText('Belongs nowhere')).toBeInTheDocument();
    expect(screen.queryByText('Has a project')).not.toBeInTheDocument();
    expect(state).toEqual({ filters: [], groupBy: { field: 'projectId' }, sort: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Has a project')).toBeInTheDocument();
    expect(screen.getByText('No project')).toBeInTheDocument();
  });
});
