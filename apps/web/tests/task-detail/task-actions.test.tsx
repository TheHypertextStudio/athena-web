/**
 * The task masthead's overflow menu: what it offers, to whom, and what each item asks of the page.
 */
import '@testing-library/jest-dom/vitest';

import type { TaskDetail } from '@docket/work/task-model';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DescriptionExpansion } from '../../src/components/task-detail/use-description-expansion';

const clipboard = vi.hoisted(() => ({ write: vi.fn(), report: vi.fn() }));

vi.mock('../../src/components/clipboard', () => ({ useCopyOutcome: () => clipboard.report }));
vi.mock('../../src/lib/clipboard/write', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canWriteClipboard: () => true,
  writeClipboard: clipboard.write,
}));
vi.mock('../../src/components/time-tracking', () => ({
  TaskTimerButton: () => <button type="button">Track this task</button>,
}));

const { TaskOverflowMenu } = await import('../../src/components/task-detail/task-actions');

afterEach(() => {
  cleanup();
  clipboard.write.mockReset();
  clipboard.report.mockReset();
});

const TASK = {
  id: 'task_1',
  organizationId: 'org_1',
  title: 'Ship it',
} as unknown as TaskDetail;

function expansionFor(overrides: Partial<DescriptionExpansion> = {}): DescriptionExpansion {
  return {
    pending: false,
    notice: null,
    undoToken: null,
    expand: vi.fn(),
    undo: vi.fn(),
    ...overrides,
  };
}

interface MenuOptions {
  readonly canEdit?: boolean;
  readonly canManage?: boolean;
  readonly expansion?: DescriptionExpansion;
  readonly onOpenChange?: (open: boolean) => void;
}

function openMenu({
  canEdit = true,
  canManage = true,
  expansion = expansionFor(),
  onOpenChange = vi.fn(),
}: MenuOptions = {}): void {
  render(
    <TaskOverflowMenu
      orgId="org_1"
      task={TASK}
      canEdit={canEdit}
      canManage={canManage}
      expansion={expansion}
      deletePrompt={{ open: false, onOpenChange }}
    />,
  );
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Task actions' }), {
    button: 0,
    ctrlKey: false,
  });
}

describe('TaskOverflowMenu', () => {
  it('offers exactly expand, copy link, and delete, with no copy of any property', async () => {
    openMenu();

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Expand description',
      'Copy link',
      'Delete task',
    ]);
  });

  it('starts an expansion from its item', async () => {
    const expansion = expansionFor();
    openMenu({ expansion });

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand description' }));

    expect(expansion.expand).toHaveBeenCalledOnce();
  });

  it('holds the expand item while a request is in flight', async () => {
    openMenu({ expansion: expansionFor({ pending: true }) });

    expect(await screen.findByRole('menuitem', { name: 'Expand description' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('asks the page to confirm before deleting', async () => {
    const onOpenChange = vi.fn();
    openMenu({ onOpenChange });

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete task' }));

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('copies the task as a link and reports whether the clipboard took it', async () => {
    clipboard.write.mockResolvedValue(true);
    openMenu();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }));

    await vi.waitFor(() => {
      expect(clipboard.report).toHaveBeenCalledWith(true);
    });
    const payload = clipboard.write.mock.calls[0]?.[0] as { readonly text: string };
    expect(payload.text).toContain('/orgs/org_1/tasks/task_1');
  });

  it('leaves out what the viewer cannot do', async () => {
    openMenu({ canEdit: false, canManage: false });

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Copy link']);
  });
});
