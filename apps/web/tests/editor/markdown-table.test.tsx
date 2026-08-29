import '@testing-library/jest-dom/vitest';

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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Tiptap may replace its initial document DOM after the textbox first appears. Resolve the
    // cell again before each click so JSDOM never sends the event to a detached first render.
    const firstCell = editor.querySelector('th');
    if (firstCell === null) {
      throw new Error('Expected the Markdown fixture to render a header cell.');
    }
    await user.click(firstCell);
    await user.keyboard('{ArrowRight}');

    try {
      await waitFor(
        () => {
          expect(screen.queryByRole('toolbar', { name: 'Table controls' })).not.toBeNull();
        },
        { timeout: 1_500 },
      );
      return;
    } catch (error) {
      if (attempt === 2) throw error;
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
