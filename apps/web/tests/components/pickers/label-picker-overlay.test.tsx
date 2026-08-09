/**
 * Behavior tests for {@link LabelPickerOverlay} (Task 4).
 *
 * @remarks
 * Task 4's own test (`picker-overlay.test.tsx`) only proves the popover opens — a smoke test. This
 * pins the popover's actual contract:
 *
 * - a label reads as checked only when *every* target object currently carries it;
 * - toggling a partially- or un-applied label applies it to every object that lacks it;
 * - toggling a fully-applied label removes it from every object that has it;
 * - `current` resolves from the task-detail query when the caller omits it;
 * - inline creation applies the freshly-created label to every target immediately;
 * - the popover reports closed (`onClose`) when Radix's own dismissal fires;
 * - a failed write reverts only the object(s) it actually failed for and surfaces an inline error
 *   (fix-pass Important #1);
 * - a failed task-detail or labels-list read renders an inline error instead of an endless
 *   skeleton or a false "No labels" empty state (fix-pass Important #2).
 */
import '@testing-library/jest-dom/vitest';

import { LabelId, OrganizationId } from '@docket/types';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LabelPickerOverlay,
  resolveCloseFocusTarget,
} from '@/components/pickers/label-picker-overlay';
import { makeQueryWrapper } from '../../support/query';

// `vi.mock` factories are hoisted above this file's own top-level statements, so the mock
// functions the factory below closes over must come from `vi.hoisted` rather than plain `const`s
// — otherwise the factory (evaluated the moment `@/lib/api` is first imported, which happens
// before any of this file's own code runs) would read them before they exist.
const { LABELS_GET, TASK_PATCH, TASK_GET, LABEL_CREATE } = vi.hoisted(() => ({
  LABELS_GET: vi.fn(),
  TASK_PATCH: vi.fn(),
  TASK_GET: vi.fn(),
  LABEL_CREATE: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          labels: {
            $get: LABELS_GET,
            $post: LABEL_CREATE,
          },
          tasks: {
            ':id': {
              $get: TASK_GET,
              $patch: TASK_PATCH,
            },
          },
        },
      },
    },
  },
}));

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');
const BUG = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const URGENT = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const NEW_LABEL = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA3');

const TASK_A = { kind: 'task' as const, id: 'task_a', organizationId: ORG, title: 'A' };
const TASK_B = { kind: 'task' as const, id: 'task_b', organizationId: ORG, title: 'B' };

beforeEach(() => {
  // `vi.restoreAllMocks()` below does not clear a plain `vi.fn()`'s call history (only its
  // implementation, and only when it was created via `vi.spyOn`) — without this, call counts from
  // an earlier test's `TASK_PATCH` clicks would carry into the next test's assertions.
  vi.clearAllMocks();
  // Re-established every test: only `LABELS_GET`/`TASK_PATCH` are needed by (almost) every test —
  // the others (`TASK_GET`, `LABEL_CREATE`) are set per-test where they matter.
  LABELS_GET.mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        items: [
          {
            id: BUG,
            organizationId: ORG,
            name: 'Bug',
            color: '#ef4444',
            teamId: null,
            createdAt: '2026-08-01T00:00:00.000Z',
          },
          {
            id: URGENT,
            organizationId: ORG,
            name: 'Urgent',
            color: '#f97316',
            teamId: null,
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      }),
  });
  TASK_PATCH.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderOverlay(overrides: Partial<React.ComponentProps<typeof LabelPickerOverlay>> = {}) {
  const { wrapper } = makeQueryWrapper();
  const onClose = vi.fn();
  render(
    <LabelPickerOverlay
      request={{
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A],
        current: new Map([['task:task_a', [BUG]]]),
      }}
      onClose={onClose}
      {...overrides}
    />,
    { wrapper },
  );
  return { onClose };
}

describe('LabelPickerOverlay', () => {
  it('checks a label already on the single target object', async () => {
    renderOverlay();
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    expect(bugRow).toHaveAttribute('aria-selected', 'true');
    const urgentRow = screen.getByRole('option', { name: /Urgent/ });
    expect(urgentRow).toHaveAttribute('aria-selected', 'false');
  });

  it('checks a label only when every target object carries it', async () => {
    renderOverlay({
      request: {
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A, TASK_B],
        current: new Map([
          ['task:task_a', [BUG]],
          ['task:task_b', []],
        ]),
      },
    });
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    expect(bugRow).toHaveAttribute('aria-selected', 'false');
  });

  it('applies a partially-carried label to every target object', async () => {
    renderOverlay({
      request: {
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A, TASK_B],
        current: new Map([
          ['task:task_a', [BUG]],
          ['task:task_b', []],
        ]),
      },
    });
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    fireEvent.click(within(bugRow).getByRole('button'));

    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledTimes(1); // task_a already has it -> only task_b writes
    });
    expect(TASK_PATCH).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: ORG, id: 'task_b' }, json: { labels: [BUG] } }),
    );
    // Optimistic local state now shows Bug checked for both.
    expect(screen.getByRole('option', { name: /Bug/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('removes a fully-applied label from every target object', async () => {
    renderOverlay({
      request: {
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A, TASK_B],
        current: new Map([
          ['task:task_a', [BUG]],
          ['task:task_b', [BUG]],
        ]),
      },
    });
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    fireEvent.click(within(bugRow).getByRole('button'));

    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledTimes(2);
    });
    expect(TASK_PATCH).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: ORG, id: 'task_a' }, json: { labels: [] } }),
    );
    expect(TASK_PATCH).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: ORG, id: 'task_b' }, json: { labels: [] } }),
    );
  });

  it('resolves current labels from the task detail query when the caller omits current', async () => {
    TASK_GET.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'task_a',
          organizationId: ORG,
          labels: [{ id: BUG, name: 'Bug', color: '#ef4444' }],
        }),
    });
    const { wrapper } = makeQueryWrapper();
    render(
      <LabelPickerOverlay
        request={{ kind: 'labels', organizationId: ORG, objects: [TASK_A] }}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    expect(bugRow).toHaveAttribute('aria-selected', 'true');
    expect(TASK_GET).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: ORG, id: 'task_a' } }),
    );
  });

  it('creates a label from typed text and applies it to every target object', async () => {
    LABEL_CREATE.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: NEW_LABEL,
          organizationId: ORG,
          name: 'Backend',
          color: '#0ea5e9',
          createdAt: '2026-08-09T00:00:00.000Z',
        }),
    });
    renderOverlay();
    const search = await screen.findByRole('textbox');
    fireEvent.change(search, { target: { value: 'Backend' } });
    const createRow = await screen.findByRole('option', { name: /Create/ });
    fireEvent.click(within(createRow).getByRole('button'));

    await waitFor(() => {
      expect(LABEL_CREATE).toHaveBeenCalledWith(
        expect.objectContaining({ json: { name: 'Backend' } }),
      );
    });
    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledWith(
        expect.objectContaining({
          param: { orgId: ORG, id: 'task_a' },
          json: { labels: expect.arrayContaining([BUG, NEW_LABEL]) },
        }),
      );
    });
  });

  it('closes when the popover reports it closed', async () => {
    const { onClose } = renderOverlay();
    await screen.findByRole('option', { name: /Bug/ });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('reverts a failed write and surfaces an inline error', async () => {
    TASK_PATCH.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: 'internal' }),
    });
    renderOverlay({
      request: {
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A],
        current: new Map([['task:task_a', []]]),
      },
    });
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    expect(bugRow).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(within(bugRow).getByRole('button'));

    // Optimistic: checked immediately after the click.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Bug/ })).toHaveAttribute('aria-selected', 'true');
    });

    // Reverted once the failing write settles, with the failure surfaced inline.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Bug/ })).toHaveAttribute('aria-selected', 'false');
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not update labels/i);
  });

  it('does not revert a sibling object whose write succeeded when another object in the same toggle fails', async () => {
    TASK_PATCH.mockImplementation((args: { param: { id: string } }) => {
      if (args.param.id === 'task_b') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ code: 'internal' }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
    renderOverlay({
      request: {
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A, TASK_B],
        current: new Map([
          ['task:task_a', []],
          ['task:task_b', []],
        ]),
      },
    });
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    fireEvent.click(within(bugRow).getByRole('button'));

    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledTimes(2);
    });
    await screen.findByRole('alert');

    // Toggle again: task_a already carries Bug (its write was never reverted) so it is skipped;
    // only task_b -- still missing it after its revert -- gets written again.
    fireEvent.click(within(screen.getByRole('option', { name: /Bug/ })).getByRole('button'));

    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledTimes(3);
    });
    const taskACalls = TASK_PATCH.mock.calls.filter(
      (args: unknown[]) => (args[0] as { param: { id: string } }).param.id === 'task_a',
    );
    expect(taskACalls).toHaveLength(1);
    const taskBCalls = TASK_PATCH.mock.calls.filter(
      (args: unknown[]) => (args[0] as { param: { id: string } }).param.id === 'task_b',
    );
    expect(taskBCalls).toHaveLength(2);
  });

  it('shows an inline error instead of an endless skeleton when the task-detail fetch fails', async () => {
    TASK_GET.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: 'internal' }),
    });
    const { wrapper } = makeQueryWrapper();
    render(
      <LabelPickerOverlay
        request={{ kind: 'labels', organizationId: ORG, objects: [TASK_A] }}
        onClose={vi.fn()}
      />,
      { wrapper },
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('shows an inline error instead of "No labels" when the labels fetch fails', async () => {
    LABELS_GET.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: 'internal' }),
    });
    renderOverlay();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No labels')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});

/**
 * {@link resolveCloseFocusTarget} unit tests (fix-pass Important #3).
 *
 * @remarks
 * The popover has no `PopoverTrigger` (it is anchored via `virtualRef`), so Radix's default
 * `onCloseAutoFocus` behavior has nothing to refocus and drops focus to `<body>` on close. Driving
 * that end-to-end through Radix's real open/close focus-restoration machinery is awkward in jsdom
 * — this popover's `open` prop is a constant `true` (Radix is never told to transition from open
 * to closed; the real close is `PickerOverlayProvider` unmounting the component entirely), so
 * there is no reliable way in a component-level test to trigger Radix's own `onCloseAutoFocus`
 * dispatch and assert `toHaveFocus()` on the result. These tests instead pin the pure
 * target-resolution logic the handler calls directly.
 */
describe('resolveCloseFocusTarget', () => {
  it('prefers the anchor element\'s enclosing [role="grid"]', () => {
    const grid = document.createElement('div');
    grid.setAttribute('role', 'grid');
    const row = document.createElement('div');
    const anchor = document.createElement('a');
    row.appendChild(anchor);
    grid.appendChild(row);
    document.body.appendChild(grid);

    expect(resolveCloseFocusTarget(anchor)).toBe(grid);

    grid.remove();
  });

  it('falls back to the anchor element itself when there is no enclosing grid', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    expect(resolveCloseFocusTarget(anchor)).toBe(anchor);

    anchor.remove();
  });

  it('returns null for a non-element virtual anchor', () => {
    const virtual = { getBoundingClientRect: () => new DOMRect() };
    expect(resolveCloseFocusTarget(virtual)).toBeNull();
  });

  it('returns null when there is no anchor at all', () => {
    expect(resolveCloseFocusTarget(null)).toBeNull();
  });
});
