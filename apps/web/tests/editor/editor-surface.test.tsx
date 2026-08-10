import '@testing-library/jest-dom/vitest';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentOut } from '@docket/types';
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerShell } from '@/components/composer/composer-shell';
import { EntityDocument } from '@/components/editor/entity-document';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { CommentActivityFeed } from '@/components/task-detail/CommentActivityFeed';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => null,
  useActiveOrgIdOptional: () => null,
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
    const surface = await screen.findByRole('document');
    expect(surface.getAttribute('contenteditable')).toBe('false');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('focuses the composer body editor from a click on its own tinted background/padding', async () => {
    renderEditor(
      <ComposerShell
        open
        onOpenChange={vi.fn()}
        heading="New task"
        title=""
        onTitleChange={vi.fn()}
        titlePlaceholder="Task name"
        body=""
        onBodyChange={vi.fn()}
        bodyPlaceholder="Add description"
        creating={false}
        canSubmit={false}
        onSubmit={vi.fn()}
        submitLabel="Create"
      >
        <div />
      </ComposerShell>,
    );
    const surface = await screen.findByRole('textbox', { name: 'Add description' });
    // There is no separate padded wrapper: the background/padding live on the same element the
    // editor already makes clickable everywhere, so this *is* the click-anywhere surface.
    const box = surface.closest('[data-editor-surface]');
    expect(box).not.toBeNull();
    fireEvent.mouseDown(box as HTMLElement, { bubbles: true });
    await waitFor(() => {
      expect(document.activeElement).toBe(surface);
    });
  });

  it('focuses the comment composer from a click on its own tinted background/padding', async () => {
    renderEditor(
      <CommentActivityFeed
        comments={[]}
        activities={[]}
        resolveActor={() => ({ name: 'Ada', kind: 'human' })}
        onComment={vi.fn(async () => undefined)}
        canComment
      />,
    );
    const surface = await screen.findByRole('textbox', { name: 'Add a comment' });
    const box = surface.closest('[data-editor-surface]');
    expect(box).not.toBeNull();
    fireEvent.mouseDown(box as HTMLElement, { bubbles: true });
    await waitFor(() => {
      expect(document.activeElement).toBe(surface);
    });
  });

  it('renders persisted comment Markdown through the shared read-only surface', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor(
      <CommentActivityFeed
        comments={[
          CommentOut.parse({
            id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
            authorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
            subjectType: 'task',
            subjectId: 'task_1',
            body: 'Run `pnpm test`.\n\n```typescript\nconst ready = true\n```',
            parentCommentId: null,
            editedAt: null,
            createdAt: '2026-08-09T12:00:00.000Z',
          }),
        ]}
        activities={[]}
        resolveActor={() => ({ name: 'Ada', kind: 'human' })}
        onComment={vi.fn(async () => undefined)}
        canComment={false}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-inline-code]')).toHaveTextContent('pnpm test');
    });
    expect(container.querySelector('[data-code-block]')).toHaveTextContent('const ready = true');
    expect(container.querySelector('[data-static-markdown]')).not.toBeNull();
    expect(container.querySelector('.ProseMirror')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('const ready = true');
  });
});

describe('description edit sessions', () => {
  it('does not let a lagging controlled value overwrite newer focused input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function LaggingControlledEditor(): ReactElement {
      const [value, setValue] = useState('Persisted');
      const previousEmission = useRef<string | null>(null);

      return (
        <FreeformTextEditor
          value={value}
          onChange={(next) => {
            const staleValue = previousEmission.current;
            previousEmission.current = next;
            onChange(next);
            if (staleValue !== null) setValue(staleValue);
          }}
          placeholder="Write something"
          ariaLabel="Description"
        />
      );
    }

    renderEditor(<LaggingControlledEditor />);
    const surface = await screen.findByRole('textbox', { name: 'Description' });
    fireEvent.mouseDown(surface.closest<HTMLElement>('[data-editor-surface]')!);
    await waitFor(() => expect(surface).toHaveFocus());
    await user.keyboard(' final');

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith('Persisted final');
    });
    expect(surface).toHaveTextContent('Persisted final');
  });

  it('flushes the final draft as soon as focus leaves the editor', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderEditor(<EntityDocument value="Persisted" canEdit onSave={onSave} />);
    const surface = await screen.findByRole('textbox', { name: 'Description' });

    fireEvent.mouseDown(surface.closest<HTMLElement>('.entity-document')!);
    await waitFor(() => expect(surface).toHaveFocus());
    await user.keyboard(' final');
    expect(onSave).not.toHaveBeenCalled();
    const finalDraft = surface.textContent.trim();
    expect(finalDraft).not.toBe('Persisted');

    fireEvent.blur(surface, { relatedTarget: document.body });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(finalDraft);
  });

  it('flushes the final draft when navigation unmounts the editor', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const mounted = renderEditor(<EntityDocument value="Persisted" canEdit onSave={onSave} />);
    const surface = await screen.findByRole('textbox', { name: 'Description' });

    fireEvent.mouseDown(surface.closest<HTMLElement>('.entity-document')!);
    await waitFor(() => expect(surface).toHaveFocus());
    await user.keyboard(' final');
    expect(onSave).not.toHaveBeenCalled();
    const finalDraft = surface.textContent.trim();
    expect(finalDraft).not.toBe('Persisted');

    mounted.unmount();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(finalDraft);
  });
});

describe('editor insets are symmetric', () => {
  /** Repository root, derived from this file rather than the process CWD. */
  const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

  /**
   * Every editor container class string in the app, with its file — both the reusable document
   * card (tagged `entity-document`) and any call site that gives `FreeformTextEditor` its own
   * tinted background directly (composer bodies, the comment composer). A `bg-*` class is what
   * marks a `FreeformTextEditor` className as *drawing* the visual container rather than just
   * forwarding type styling, which is the only case this inset rule applies to.
   */
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
        const path = relative(REPO_ROOT, full).split(/[\\/]/).join('/');
        for (const match of text.matchAll(/className="([^"]*\bentity-document\b[^"]*)"/g)) {
          found.push({ path, classes: match[1] ?? '' });
        }
        for (const match of text.matchAll(/<FreeformTextEditor[^]*?\/>/g)) {
          const classNameMatch = /className="([^"]*)"/.exec(match[0]);
          const classes = classNameMatch?.[1] ?? '';
          if (/(^|\s)bg-/.test(classes)) found.push({ path, classes });
        }
      }
    };
    walk(join(REPO_ROOT, 'apps/web/src'));
    return found;
  }

  it('uses one padding value on all four sides of every visually tinted editor surface', () => {
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
