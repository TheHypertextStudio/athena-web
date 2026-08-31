import '@testing-library/jest-dom/vitest';

import { Dialog, DialogContent, DialogTitle } from '@docket/ui/primitives';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditableFreeformText, FreeformTextEditor } from '@/components/editor/freeform-text';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: null }),
  useActiveOrgIdOptional: () => null,
  useActiveOrg: () => ({ activeOrgId: null }),
}));

installProseMirrorLayoutShims();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TABLE = '| Name | Count |\n| --- | ---: |\n| Tasks | 3 |';

/** Render an editable Markdown table through the same shared surface used by entity descriptions. */
function renderTable() {
  const onChange = vi.fn<(next: string) => void>();
  const { wrapper: Wrapper } = makeQueryWrapper();
  render(
    <Wrapper>
      <FreeformTextEditor
        value={TABLE}
        onChange={onChange}
        placeholder="Write something"
        ariaLabel="Description"
      />
    </Wrapper>,
  );
  return { onChange, user: userEvent.setup() };
}

/** Focus the existing first-cell selection and make ProseMirror publish it to contextual plugins. */
async function focusTable(
  editor: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  // Tiptap replaces its initial document DOM after the textbox first appears, and it does so on
  // its own schedule — under a loaded test host the replacement can land well after mount. Wait
  // for a header cell to exist at all before spending any click attempts on it.
  await waitFor(() => {
    expect(editor.querySelector('th')).not.toBeNull();
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // Resolve the cell again before each click so JSDOM never sends the event to a detached
    // first render.
    const firstCell = editor.querySelector('th');
    if (firstCell === null) {
      throw new Error('Expected the Markdown fixture to render a header cell.');
    }
    await user.click(firstCell);
    await user.keyboard('{ArrowRight}');

    try {
      // The per-attempt budget must absorb a slow scheduler tick on a fully loaded CPU (the
      // whole suite runs in parallel workers), not just the happy-path render — a budget the
      // toolbar routinely meets in isolation is exactly the one that flakes under load.
      await waitFor(
        () => {
          expect(screen.queryByRole('toolbar', { name: 'Table controls' })).not.toBeNull();
        },
        { timeout: 3_000 },
      );
      return;
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
}

describe('editing a Markdown table', () => {
  it('shows table controls only while a table cell is active', async () => {
    const { user } = renderTable();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    expect(screen.queryByRole('toolbar', { name: 'Table controls' })).toBeNull();
    await focusTable(editor, user);

    expect(await screen.findByRole('toolbar', { name: 'Table controls' })).toBeVisible();
    expect(editor.querySelector('.tableWrapper')).toHaveAttribute('data-table-controls-visible');
  });

  it('mounts table controls outside the editor surface so scrolling cannot clip them', async () => {
    const { user } = renderTable();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);

    const toolbar = await screen.findByRole('toolbar', { name: 'Table controls' });

    expect(toolbar.parentElement).toHaveAttribute('data-table-controls-portal');
    expect(toolbar.parentElement?.parentElement).toBe(document.body);
  });

  it('tracks the nearest scrolling ancestor outside a composer', async () => {
    const scrollOwner = document.createElement('div');
    scrollOwner.style.overflowY = 'auto';
    document.body.append(scrollOwner);
    const addScrollListener = vi.spyOn(scrollOwner, 'addEventListener');
    const { wrapper: Wrapper } = makeQueryWrapper();

    render(
      <Wrapper>
        <FreeformTextEditor
          value={TABLE}
          onChange={vi.fn()}
          placeholder="Write something"
          ariaLabel="Description"
        />
      </Wrapper>,
      { container: scrollOwner },
    );

    await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => {
      const pluginListeners = addScrollListener.mock.calls
        .filter(([type]) => type === 'scroll')
        .map(([, listener]) => listener)
        .filter(
          (listener) =>
            typeof listener === 'function' && listener.name !== 'bound dispatchContinuousEvent',
        );
      expect(pluginListeners).toHaveLength(1);
    });
  });

  it('keeps portaled table controls inside a modal focus and pointer boundary', async () => {
    const onChange = vi.fn<(next: string) => void>();
    const { wrapper: Wrapper } = makeQueryWrapper();
    render(
      <Wrapper>
        <Dialog open onOpenChange={vi.fn()}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Edit task</DialogTitle>
            <button type="button">Task title control</button>
            <div data-testid="editor-scrollport">
              <FreeformTextEditor
                value={TABLE}
                onChange={onChange}
                placeholder="Write something"
                ariaLabel="Description"
              />
            </div>
          </DialogContent>
        </Dialog>
      </Wrapper>,
    );
    const user = userEvent.setup();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);

    const toolbar = await screen.findByRole('toolbar', { name: 'Table controls' });
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });

    expect(toolbar.parentElement).toHaveAttribute('data-table-controls-portal');
    expect(toolbar.parentElement?.parentElement).toBe(dialog);
    expect(screen.getByTestId('editor-scrollport')).not.toContainElement(toolbar);

    await user.keyboard('{Alt>}{F10}{/Alt}');
    expect(within(toolbar).getByRole('button', { name: 'Add row' })).toHaveFocus();
    await user.keyboard('{Escape}');

    await user.click(within(toolbar).getByRole('button', { name: 'Table options' }));
    const addColumnItem = await screen.findByRole('menuitem', { name: 'Add column' });
    expect(dialog).toContainElement(addColumnItem);
    expect(toolbar).toBeVisible();
    await user.keyboard('{Escape}');
    // Closing the menu moves focus on its own schedule, and two owners race for it: Radix
    // restores the trigger, while the toolbar's own Escape handler refocuses the editor —
    // whichever saw the key first. Both outcomes keep the toolbar legitimately visible; what the
    // dismissal below cannot tolerate is clicking outside while that restoration is still
    // pending, because a deferred focus landing INSIDE the toolbar after the hide re-satisfies
    // `shouldShow` and re-opens it. Wait for the close to fully settle first.
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Add column' })).toBeNull();
      expect(document.activeElement === editor || toolbar.contains(document.activeElement)).toBe(
        true,
      );
    });

    const taskTitleControl = screen.getByRole('button', { name: 'Task title control' });
    await user.click(taskTitleControl);
    // Same load allowance as focusTable: dismissal rides a selection-change tick that can lag
    // behind the click when the suite's parallel workers saturate the host.
    await waitFor(
      () => {
        expect(screen.queryByRole('toolbar', { name: 'Table controls' })).toBeNull();
        expect(editor.querySelector('.tableWrapper')).not.toHaveAttribute(
          'data-table-controls-visible',
        );
      },
      { timeout: 3_000 },
    );
  });

  it('moves keyboard focus into and back out of the table controls', async () => {
    const { user } = renderTable();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);

    await user.keyboard('{Alt>}{F10}{/Alt}');

    const toolbar = await screen.findByRole('toolbar', { name: 'Table controls' });
    expect(within(toolbar).getByRole('button', { name: 'Add row' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(editor).toHaveFocus();
    });
  });

  it('does not pass the toolbar Escape key to its host surface', async () => {
    const onHostKeyDown = vi.fn();
    const onChange = vi.fn<(next: string) => void>();
    const { wrapper: Wrapper } = makeQueryWrapper();
    render(
      <div onKeyDown={onHostKeyDown}>
        <Wrapper>
          <FreeformTextEditor
            value={TABLE}
            onChange={onChange}
            placeholder="Write something"
            ariaLabel="Description"
          />
        </Wrapper>
      </div>,
    );
    const user = userEvent.setup();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);
    await user.keyboard('{Alt>}{F10}{/Alt}');

    onHostKeyDown.mockClear();
    await user.keyboard('{Escape}');

    expect(onHostKeyDown).not.toHaveBeenCalled();
  });

  it('adds one row and one column through the contextual controls', async () => {
    const { user, onChange } = renderTable();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);
    const toolbar = await screen.findByRole('toolbar', { name: 'Table controls' });

    await user.click(within(toolbar).getByRole('button', { name: 'Add row' }));
    await user.click(within(toolbar).getByRole('button', { name: 'Add column' }));

    await waitFor(() => {
      expect(editor.querySelectorAll('tr')).toHaveLength(3);
      expect(editor.querySelectorAll('th')).toHaveLength(3);
      expect(onChange.mock.calls.at(-1)?.[0] ?? '').toContain('| Name');
    });
  });

  it('copies the whole table as Markdown without requiring a cell selection', async () => {
    const { user } = renderTable();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);
    const toolbar = await screen.findByRole('toolbar', { name: 'Table controls' });

    await user.click(within(toolbar).getByRole('button', { name: 'Copy table' }));

    await waitFor(() => {
      expect(within(toolbar).getByRole('button', { name: 'Copy table' })).toHaveAttribute(
        'data-copy-state',
        'copied',
      );
    });
    expect(await navigator.clipboard.readText()).toContain('| Name');
    expect(await navigator.clipboard.readText()).toContain('| Tasks');
  });

  it('copies the whole table as CSV from its options menu', async () => {
    const { user } = renderTable();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);
    const toolbar = await screen.findByRole('toolbar', { name: 'Table controls' });

    await user.click(within(toolbar).getByRole('button', { name: 'Table options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy as CSV' }));

    await waitFor(async () => {
      await expect(navigator.clipboard.readText()).resolves.toBe('Name,Count\nTasks,3');
    });
  });

  it('keeps a table menu interaction inside one autosave session', async () => {
    const onSave = vi.fn<(next: string | null) => void>();
    const onEditStart = vi.fn<() => void>();
    const { wrapper: Wrapper } = makeQueryWrapper();
    render(
      <Wrapper>
        <EditableFreeformText
          value={TABLE}
          placeholder="Write something"
          canEdit
          onSave={onSave}
          onEditStart={onEditStart}
        />
      </Wrapper>,
    );
    const user = userEvent.setup();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);
    await user.keyboard('X');
    const toolbar = await screen.findByRole('toolbar', { name: 'Table controls' });

    await user.click(within(toolbar).getByRole('button', { name: 'Table options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy as CSV' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onEditStart).toHaveBeenCalledTimes(1);
  });

  it('keeps a portaled table action inside one autosave session', async () => {
    const onSave = vi.fn<(next: string | null) => void>();
    const onEditStart = vi.fn<() => void>();
    const { wrapper: Wrapper } = makeQueryWrapper();
    render(
      <Wrapper>
        <EditableFreeformText
          value={TABLE}
          placeholder="Write something"
          canEdit
          onSave={onSave}
          onEditStart={onEditStart}
        />
      </Wrapper>,
    );
    const user = userEvent.setup();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await focusTable(editor, user);
    await user.keyboard('X');
    const toolbar = await screen.findByRole('toolbar', { name: 'Table controls' });

    await user.click(within(toolbar).getByRole('button', { name: 'Add row' }));

    // The property under guard: a portaled control is INSIDE the edit session. If its click
    // leaked out as an outside interaction, the session would end (a second `onEditStart` on the
    // next edit), the toolbar would dismiss, and the row command would never run. The quiet-timer
    // autosave is deliberately NOT asserted against wall-clock here — the surface's 2s debounce
    // may legitimately elapse mid-test on a loaded host (Tiptap's normalized serialization of the
    // fixture counts as a pending change from mount), and such a commit does not end the session.
    expect(within(editor).getAllByRole('row')).toHaveLength(3);
    expect(toolbar).toBeVisible();
    expect(onEditStart).toHaveBeenCalledTimes(1);
    // A background commit mid-session, if one happened, saves content — never the null that
    // means "cleared".
    for (const call of onSave.mock.calls) {
      expect(call[0]).not.toBeNull();
    }
  });

  it('keeps table controls out of read-only documents', async () => {
    const { wrapper: Wrapper } = makeQueryWrapper();
    render(
      <Wrapper>
        <FreeformTextEditor
          value={TABLE}
          onChange={vi.fn()}
          placeholder="Write something"
          ariaLabel="Description"
          readOnly
        />
      </Wrapper>,
    );

    expect(await screen.findByRole('document')).toHaveTextContent('Tasks');
    expect(screen.queryByRole('toolbar', { name: 'Table controls' })).toBeNull();
  });

  it('mounts and advertises table controls only while editing is enabled', async () => {
    const onChange = vi.fn<(next: string) => void>();
    const { wrapper: Wrapper } = makeQueryWrapper();
    const view = render(
      <Wrapper>
        <FreeformTextEditor
          value={TABLE}
          onChange={onChange}
          placeholder="Write something"
          ariaLabel="Description"
          disabled
        />
      </Wrapper>,
    );
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    expect(editor).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.queryByRole('toolbar', { name: 'Table controls' })).toBeNull();

    view.rerender(
      <Wrapper>
        <FreeformTextEditor
          value={TABLE}
          onChange={onChange}
          placeholder="Write something"
          ariaLabel="Description"
        />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(editor).toHaveAttribute('contenteditable', 'true');
      expect(editor).toHaveAttribute('aria-keyshortcuts', 'Alt+F10');
    });
    const user = userEvent.setup();
    await focusTable(editor, user);
    expect(await screen.findByRole('toolbar', { name: 'Table controls' })).toBeVisible();

    view.rerender(
      <Wrapper>
        <FreeformTextEditor
          value={TABLE}
          onChange={onChange}
          placeholder="Write something"
          ariaLabel="Description"
          disabled
        />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(editor).toHaveAttribute('contenteditable', 'false');
      expect(editor).not.toHaveAttribute('aria-keyshortcuts');
      expect(screen.queryByRole('toolbar', { name: 'Table controls' })).toBeNull();
    });
  });
});
