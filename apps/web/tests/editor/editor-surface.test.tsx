import '@testing-library/jest-dom/vitest';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntityDocument } from '@/components/editor/entity-document';
import { FreeformTextEditor } from '@/components/editor/freeform-text';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => null,
  useActiveOrg: () => ({ activeOrgId: 'org_1' }),
}));

/**
 * `EntityDocument` observes its own headings to drive the contents rail. jsdom has no
 * IntersectionObserver, and the rail is not what these tests are about, so a no-op stands in.
 */
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe(): void {
      // Nothing to observe: layout does not exist here.
    }
    disconnect(): void {
      // Nothing was ever observed.
    }
    unobserve(): void {
      // Nothing was ever observed.
    }
    takeRecords(): [] {
      return [];
    }
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
  },
);

installProseMirrorLayoutShims();

afterEach(cleanup);

function renderEditor(ui: ReactElement) {
  const { wrapper: Wrapper } = makeQueryWrapper();
  return render(<Wrapper>{ui}</Wrapper>);
}

describe('Markdown formats as it is typed, not on blur or save', () => {
  it('renders bold, a heading, a bullet, a quote and a code block with the caret still inside', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor(
      <FreeformTextEditor
        value=""
        onChange={onChange}
        placeholder="Write something"
        ariaLabel="Description"
      />,
    );
    const surface = await screen.findByRole('textbox', { name: 'Description' });
    await user.click(surface);

    await user.keyboard('**bolded** ');
    await waitFor(() => {
      expect(surface.querySelector('strong')).not.toBeNull();
    });
    expect(surface.querySelector('strong')?.textContent).toBe('bolded');
    // Nothing was saved and focus never left: the formatting happened on the closing token.
    expect(document.activeElement).toBe(surface);

    await user.keyboard('{Enter}# A heading{Enter}');
    await waitFor(() => {
      expect(surface.querySelector('h1')?.textContent).toBe('A heading');
    });

    await user.keyboard('- a bullet{Enter}{Enter}');
    await waitFor(() => {
      expect(surface.querySelector('ul li')?.textContent).toBe('a bullet');
    });

    await user.keyboard('> quoted{Enter}{Enter}');
    await waitFor(() => {
      expect(surface.querySelector('blockquote')).not.toBeNull();
    });

    await user.keyboard('1. first{Enter}{Enter}');
    await waitFor(() => {
      expect(surface.querySelector('ol li')).not.toBeNull();
    });

    await user.keyboard('```{Enter}');
    await waitFor(() => {
      expect(surface.querySelector('pre code')).not.toBeNull();
    });

    expect(document.activeElement).toBe(surface);
  });

  it('formats inline code as soon as the closing backtick lands', async () => {
    const user = userEvent.setup();
    renderEditor(
      <FreeformTextEditor
        value=""
        onChange={vi.fn()}
        placeholder="Write something"
        ariaLabel="Description"
      />,
    );
    const surface = await screen.findByRole('textbox', { name: 'Description' });
    await user.click(surface);
    await user.keyboard('`code` ');
    await waitFor(() => {
      expect(surface.querySelector('code')?.textContent).toBe('code');
    });
  });

  it('keeps the formatting through a save and reload of the same value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderEditor(
      <FreeformTextEditor
        value=""
        onChange={onChange}
        placeholder="Write something"
        ariaLabel="Description"
      />,
    );
    const surface = await screen.findByRole('textbox', { name: 'Description' });
    await user.click(surface);
    await user.keyboard('**bolded** and `code`');
    await waitFor(() => {
      expect(surface.querySelector('strong')).not.toBeNull();
    });

    const saved = String(onChange.mock.calls.at(-1)?.[0] ?? '');
    expect(saved).toContain('**bolded**');
    expect(saved).toContain('`code`');

    // Re-mount with exactly what would have been persisted.
    cleanup();
    renderEditor(
      <FreeformTextEditor
        value={saved}
        onChange={vi.fn()}
        placeholder="Write something"
        ariaLabel="Description"
      />,
    );
    const reloaded = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => {
      expect(reloaded.querySelector('strong')?.textContent).toBe('bolded');
    });
    expect(reloaded.querySelector('code')?.textContent).toBe('code');
    void rerender;
  });
});

describe('clicking an editor-shaped surface starts editing', () => {
  it('focuses the editor from the empty space below the last line', async () => {
    renderEditor(<EntityDocument value="A single line." canEdit onSave={vi.fn()} />);
    const surface = await screen.findByRole('textbox', { name: 'Description' });
    // The wrapper that draws the editor-looking box, not the text itself.
    const box = surface.closest('[data-editor-surface]');
    expect(box).not.toBeNull();
    fireEvent.mouseDown(box as HTMLElement, { bubbles: true });
    await waitFor(() => {
      expect(document.activeElement).toBe(surface);
    });
  });

  it('does not hijack a click that landed on the text itself', async () => {
    renderEditor(<EntityDocument value="A single line." canEdit onSave={vi.fn()} />);
    const surface = await screen.findByRole('textbox', { name: 'Description' });
    const box = surface.closest('[data-editor-surface]')!;
    const handler = vi.fn();
    box.addEventListener('mousedown', handler);
    fireEvent.mouseDown(surface);
    // The event reaches the container by bubbling, but the container's own guard ignores it
    // because the target was a descendant — ProseMirror places the caret where it was clicked.
    expect(handler).toHaveBeenCalled();
  });

  it('leaves a read-only document inert', async () => {
    renderEditor(<EntityDocument value="A single line." canEdit={false} onSave={vi.fn()} />);
    const surface = await screen.findByLabelText('Description');
    expect(surface.getAttribute('contenteditable')).toBe('false');
  });
});

describe('editor insets are symmetric', () => {
  /** Repository root, derived from this file rather than the process CWD. */
  const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

  /** Every editor container class string in the app, with its file. */
  function editorContainers(): readonly { readonly path: string; readonly classes: string }[] {
    const found: { path: string; classes: string }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.tsx')) continue;
        const text = readFileSync(full, 'utf8');
        for (const match of text.matchAll(/className="([^"]*\bentity-document\b[^"]*)"/g)) {
          found.push({
            path: relative(REPO_ROOT, full).split(/[\\/]/).join('/'),
            classes: match[1] ?? '',
          });
        }
      }
    };
    walk(join(REPO_ROOT, 'apps/web/src'));
    return found;
  }

  it('uses one padding value on all four sides of every document editor', () => {
    const containers = editorContainers();
    expect(containers.length).toBeGreaterThan(0);
    for (const container of containers) {
      // `p-4` — not `px-4 py-3`. An asymmetric inset is the single most common reason an editor
      // looks subtly wrong, and it is exactly what the launch note calls out.
      expect(container.classes, container.path).toMatch(/(^|\s)p-\d/);
      expect(container.classes, container.path).not.toMatch(/(^|\s)p[xytblrse]-\d/);
    }
  });
});
