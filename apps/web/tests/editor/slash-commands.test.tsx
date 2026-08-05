import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { SLASH_COMMANDS, rankSlashCommands } from '@/components/editor/slash-commands';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

/**
 * The editor asks the shell which workspace it is in; outside the shell there is nothing to
 * mention. These tests are about the in-workspace behaviour, so the shell answer is stubbed.
 */
vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: 'org_1' }),
  useActiveOrgIdOptional: () => 'org_1',
  useActiveOrg: () => ({ activeOrgId: 'org_1' }),
}));

/**
 * `/` inside a real editor.
 *
 * @remarks
 * `@` lives in its own suite next door, because the two runs stopped sharing a hook: a slash
 * command inserts a block and never leaves the document, while a mention reaches across the
 * workspace and into connected apps. What is left here is the slash run and its ranking.
 */

/** A tiny workspace: two tasks and a project, enough to exercise filtering and disambiguation. */
const WORKSPACE = {
  tasks: [
    { id: 'task_1', title: 'Launch checklist', projectId: 'proj_1' },
    { id: 'task_2', title: 'Backlog grooming', projectId: null },
  ],
  projects: [{ id: 'proj_1', name: 'Launch Docket' }],
  initiatives: [] as unknown[],
  programs: [] as unknown[],
  members: [{ id: 'mem_1', displayName: 'Ada Lovelace' }],
};

installProseMirrorLayoutShims();

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : ((input as { readonly url?: string }).url ?? '');
      const body = url.includes('/tasks')
        ? { items: WORKSPACE.tasks }
        : url.includes('/projects')
          ? { items: WORKSPACE.projects }
          : url.includes('/initiatives')
            ? { items: WORKSPACE.initiatives }
            : url.includes('/programs')
              ? { items: WORKSPACE.programs }
              : url.includes('/members')
                ? { items: WORKSPACE.members }
                : { items: [] };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderEditor(ui: ReactElement) {
  const { wrapper: Wrapper } = makeQueryWrapper();
  return render(<Wrapper>{ui}</Wrapper>);
}

/** Render the editor and hand back its writing surface. */
async function openEditor(onChange = vi.fn()): Promise<{
  readonly surface: HTMLElement;
  readonly onChange: ReturnType<typeof vi.fn>;
  readonly user: ReturnType<typeof userEvent.setup>;
}> {
  const user = userEvent.setup();
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
  return { surface, onChange, user };
}

describe('the slash insert menu', () => {
  it('opens on `/` at the start of an empty line and offers every block', async () => {
    const { user } = await openEditor();
    await user.keyboard('/');
    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    const options = within(menu).getAllByRole('option');
    expect(options).toHaveLength(SLASH_COMMANDS.length);
    const labels = options.map((option) => option.textContent);
    for (const required of [
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'Checklist',
      'Quote',
      'Code block',
      'Divider',
    ]) {
      expect(labels.some((label) => label.startsWith(required))).toBe(true);
    }
  });

  it('filters as you keep typing', async () => {
    const { user } = await openEditor();
    await user.keyboard('/quo');
    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    await waitFor(() => {
      expect(within(menu).getAllByRole('option')).toHaveLength(1);
    });
    expect(within(menu).getByRole('option')).toHaveTextContent('Quote');
  });

  it('moves the highlight with the arrow keys', async () => {
    const { user } = await openEditor();
    await user.keyboard('/');
    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    expect(within(menu).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(within(menu).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    });
    await user.keyboard('{ArrowUp}');
    await waitFor(() => {
      expect(within(menu).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('replaces the typed query with the chosen block, leaving no stray slash', async () => {
    const { user, surface } = await openEditor();
    await user.keyboard('/quo');
    await screen.findByRole('listbox', { name: 'Insert a block' });
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(surface.querySelector('blockquote')).not.toBeNull();
    });
    expect(surface.textContent).not.toContain('/quo');
  });

  it('closes on Escape and leaves the typed text exactly where it was', async () => {
    const { user, surface } = await openEditor();
    await user.keyboard('/quo');
    await screen.findByRole('listbox', { name: 'Insert a block' });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Insert a block' })).not.toBeInTheDocument();
    });
    expect(surface.textContent).toContain('/quo');
    // Typing on does not resurrect the menu for the same trigger.
    await user.keyboard('t');
    expect(screen.queryByRole('listbox', { name: 'Insert a block' })).not.toBeInTheDocument();
  });

  it('does not fire mid-line, where a slash is a slash', async () => {
    const { user } = await openEditor();
    await user.keyboard('and/or');
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Insert a block' })).not.toBeInTheDocument();
    });
  });
});

describe('slash-command ranking', () => {
  it('matches slash commands on keywords, not only labels', () => {
    expect(rankSlashCommands('bullet').map((command) => command.id)).toContain('bullet-list');
  });

  it('returns every command for an empty query', () => {
    expect(rankSlashCommands('')).toHaveLength(SLASH_COMMANDS.length);
  });
});
