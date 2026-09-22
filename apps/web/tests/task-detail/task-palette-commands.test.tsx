/**
 * The task page's relationship commands in the palette.
 *
 * @remarks
 * Each command must open the same control the page shows, on the tab that shows it, and only
 * commands whose control is on screen are offered.
 */
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const aside = vi.hoisted(() => ({ docked: true }));

vi.mock('../../src/components/views/entity-detail-layout', () => ({
  useEntityDetailAside: () => aside,
}));

const { usePageCommands } = await import('../../src/components/command-palette/page-commands');
const { TaskPaletteCommands } =
  await import('../../src/components/task-detail/task-palette-commands');
const { TaskRelationCommandsProvider, useTaskRelationCommands } =
  await import('../../src/components/task-detail/task-relation-commands');

let active: string | null = null;

/** Mirrors the page's open control out of the provider so a test can read it. */
function ActiveProbe(): null {
  active = useTaskRelationCommands().active;
  return null;
}

function mount(props: { canEdit?: boolean; tab?: 'overview' | 'resources' | 'graph' } = {}) {
  const onTabChange = vi.fn();
  const view = render(
    <TaskRelationCommandsProvider>
      <TaskPaletteCommands
        canEdit={props.canEdit ?? true}
        tab={props.tab ?? 'overview'}
        onTabChange={onTabChange}
      />
      <ActiveProbe />
    </TaskRelationCommandsProvider>,
  );
  const published = renderHook(() => usePageCommands());
  return { onTabChange, view, published };
}

function labels(published: ReturnType<typeof mount>['published']): string[] {
  return published.result.current.items.map((item) => item.label);
}

beforeEach(() => {
  vi.useFakeTimers();
  aside.docked = true;
  active = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskPaletteCommands', () => {
  it('offers every relationship command under "This task" while the sidebar is docked', () => {
    const { published } = mount();

    expect(published.result.current.label).toBe('This task');
    expect(labels(published)).toEqual([
      'Add subtask',
      'Add existing task as subtask',
      'Add blocker',
      'Add blocked task',
      'Add related task',
      'Set parent task',
    ]);
  });

  it('leaves out "Set parent task" when the parent picker is not on screen', () => {
    aside.docked = false;
    const { published } = mount();

    expect(labels(published)).not.toContain('Set parent task');
  });

  it('offers nothing to a viewer who cannot edit', () => {
    const { published } = mount({ canEdit: false });

    expect(published.result.current.items).toEqual([]);
  });

  it('opens the control after the palette closes, switching to the Overview tab first', () => {
    const { published, onTabChange } = mount({ tab: 'resources' });
    const addBlocker = published.result.current.items.find((item) => item.label === 'Add blocker');

    act(() => {
      addBlocker?.run();
    });
    expect(onTabChange).toHaveBeenCalledWith('overview');
    expect(active).toBeNull();

    act(() => {
      vi.runAllTimers();
    });
    expect(active).toBe('blockedBy');
  });

  it('withdraws its commands when the page unmounts', () => {
    const { view, published } = mount();

    act(() => {
      view.unmount();
    });

    expect(published.result.current.items).toEqual([]);
  });
});
