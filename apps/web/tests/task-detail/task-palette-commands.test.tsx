/**
 * The task page's relationship commands in the palette.
 *
 * @remarks
 * Each command must open the same control the page shows, on the tab that shows it, and only
 * commands whose control is on screen are offered.
 */
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageCommands } from '../../src/components/command-palette/page-commands';
import { stubRelations } from '../support/task-relations';

const aside = vi.hoisted(() => ({ docked: true }));

vi.mock('../../src/components/views/entity-detail-layout', () => ({
  useEntityDetailAside: () => aside,
}));

const { PageCommandsProvider, usePageCommands } =
  await import('../../src/components/command-palette/page-commands');
const { TaskPaletteCommands } =
  await import('../../src/components/task-detail/task-palette-commands');
const { TaskRelationsProvider, useTaskRelationControls } =
  await import('../../src/components/task-detail/task-relation-commands');

type Tab = 'overview' | 'resources' | 'graph';

let active: string | null = null;
let published: PageCommands = { label: '', items: [] };

/** Mirrors the page's open control out of its provider. */
function ActiveProbe(): null {
  active = useTaskRelationControls().active;
  return null;
}

/** Mirrors what the palette would list out of its provider. */
function PublishedProbe(): null {
  published = usePageCommands();
  return null;
}

/** Props for {@link Harness}. */
interface HarnessProps {
  readonly canEdit: boolean;
  readonly tab: Tab;
  readonly onTabChange: (tab: Tab) => void;
  /** Whether the task page is mounted. */
  readonly page: boolean;
}

function Harness({ canEdit, tab, onTabChange, page }: HarnessProps): JSX.Element {
  return (
    <PageCommandsProvider>
      {page ? (
        <TaskRelationsProvider writes={stubRelations()}>
          <TaskPaletteCommands canEdit={canEdit} tab={tab} onTabChange={onTabChange} />
          <ActiveProbe />
        </TaskRelationsProvider>
      ) : null}
      <PublishedProbe />
    </PageCommandsProvider>
  );
}

function mount(props: { canEdit?: boolean; tab?: Tab } = {}) {
  const onTabChange = vi.fn();
  const base = { canEdit: props.canEdit ?? true, tab: props.tab ?? 'overview', onTabChange };
  const view = render(<Harness {...base} page />);
  const leave = (): void => {
    view.rerender(<Harness {...base} page={false} />);
  };
  return { onTabChange, leave };
}

function labels(): string[] {
  return published.items.map((item) => item.label);
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
    mount();

    expect(published.label).toBe('This task');
    expect(labels()).toEqual([
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
    mount();

    expect(labels()).not.toContain('Set parent task');
  });

  it('offers nothing to a viewer who cannot edit', () => {
    mount({ canEdit: false });

    expect(published.items).toEqual([]);
  });

  it('opens the control after the palette closes, switching to the Overview tab first', () => {
    const { onTabChange } = mount({ tab: 'resources' });
    const addBlocker = published.items.find((item) => item.label === 'Add blocker');

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
    const { leave } = mount();

    act(() => {
      leave();
    });

    expect(published.items).toEqual([]);
  });
});
