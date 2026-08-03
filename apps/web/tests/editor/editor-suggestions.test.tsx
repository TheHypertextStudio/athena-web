import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { publishMentionLabels, resetMentionLabels } from '@/components/editor/mention-labels';
import { SLASH_COMMANDS, rankSlashCommands } from '@/components/editor/slash-commands';
import { rankMentions, type MentionEntry } from '@/components/editor/mention-directory';
import { mentionHref } from '@/components/editor/mention-node';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

/**
 * The editor asks the shell which workspace it is in; outside the shell there is nothing to
 * mention. These tests are about the in-workspace behaviour, so the shell answer is stubbed.
 */
vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: 'org_1' }),
  useActiveOrg: () => ({ activeOrgId: 'org_1' }),
}));

/**
 * `@` and `/` inside a real editor.
 *
 * @remarks
 * The mention directory is fed through the same list endpoints every other surface uses, so the
 * tests stub `fetch` once with a small workspace rather than mocking the query layer — that way
 * the response shape the app actually consumes is the shape under test.
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
  resetMentionLabels();
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

describe('the @ mention menu', () => {
  it('opens on `@` and lists the workspace across kinds', async () => {
    const { user } = await openEditor();
    await user.keyboard('@');
    const menu = await screen.findByRole('listbox', { name: 'Mention something' });
    await waitFor(() => {
      expect(within(menu).getAllByRole('option').length).toBeGreaterThan(2);
    });
    const labels = within(menu)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels.some((label) => label.includes('Launch checklist'))).toBe(true);
    expect(labels.some((label) => label.includes('Launch Docket'))).toBe(true);
    expect(labels.some((label) => label.includes('Ada Lovelace'))).toBe(true);
  });

  it('filters as you keep typing', async () => {
    const { user } = await openEditor();
    await user.keyboard('@Backlog');
    const menu = await screen.findByRole('listbox', { name: 'Mention something' });
    await waitFor(() => {
      expect(within(menu).getAllByRole('option')).toHaveLength(1);
    });
    expect(within(menu).getByRole('option')).toHaveTextContent('Backlog grooming');
  });

  it('inserts a reference carrying the object id, not just its title', async () => {
    const onChange = vi.fn();
    const { user, surface } = await openEditor(onChange);
    await user.keyboard('@Launch check');
    await screen.findByRole('listbox', { name: 'Mention something' });
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(surface.querySelector('[data-mention-id]')).not.toBeNull();
    });
    const chip = surface.querySelector('[data-mention-id]');
    expect(chip?.getAttribute('data-mention-id')).toBe('task_1');
    expect(chip?.getAttribute('data-mention-kind')).toBe('task');
    expect(chip?.textContent).toBe('@Launch checklist');

    // The persisted Markdown carries the id, so the reference survives a round trip.
    const markdown = String(onChange.mock.calls.at(-1)?.[0] ?? '');
    expect(markdown).toContain('task_1');
    expect(markdown).toContain('mention');
  });

  it('leaves the literal @ alone on Escape', async () => {
    const { user, surface } = await openEditor();
    await user.keyboard('@Lau');
    await screen.findByRole('listbox', { name: 'Mention something' });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Mention something' })).not.toBeInTheDocument();
    });
    expect(surface.textContent).toContain('@Lau');
    expect(surface.querySelector('[data-mention-id]')).toBeNull();
  });

  it('does not fire inside an email address', async () => {
    const { user } = await openEditor();
    await user.keyboard('ada@example');
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Mention something' })).not.toBeInTheDocument();
    });
  });
});

describe('a mention shows its object’s current title', () => {
  it('repaints when the referenced object is renamed', async () => {
    const { user, surface } = await openEditor();
    await user.keyboard('@Launch check');
    await screen.findByRole('listbox', { name: 'Mention something' });
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(surface.querySelector('[data-mention-id]')?.textContent).toBe('@Launch checklist');
    });

    // Somebody renames the task elsewhere in the app; the directory publishes the new title.
    publishMentionLabels([['task:task_1', 'Launch checklist v2']]);
    await waitFor(() => {
      expect(surface.querySelector('[data-mention-id]')?.textContent).toBe('@Launch checklist v2');
    });
    // The stored reference is untouched — only what is shown changed.
    expect(surface.querySelector('[data-mention-id]')?.getAttribute('data-mention-id')).toBe(
      'task_1',
    );
  });
});

describe('mention and slash ranking', () => {
  const entries: readonly MentionEntry[] = [
    { kind: 'task', id: 'a', label: 'Backlog cleanup', hint: null },
    { kind: 'task', id: 'b', label: 'Launch checklist', hint: null },
    { kind: 'project', id: 'c', label: 'Relaunch', hint: null },
  ];

  it('puts a prefix match above a word-start match above a bare substring', () => {
    expect(rankMentions(entries, 'la').map((entry) => entry.id)).toEqual(['b', 'c']);
  });

  it('returns the head of the directory for an empty query', () => {
    expect(rankMentions(entries, '', 2)).toHaveLength(2);
  });

  it('matches slash commands on keywords, not only labels', () => {
    expect(rankSlashCommands('bullet').map((command) => command.id)).toEqual(['bullet-list']);
    expect(rankSlashCommands('todo').map((command) => command.id)).toEqual(['task-list']);
    expect(rankSlashCommands('zzz')).toHaveLength(0);
  });
});

describe('mention routes', () => {
  it('points at the object it references', () => {
    expect(mentionHref('task', 't1', 'org1')).toBe('/orgs/org1/tasks/t1');
    expect(mentionHref('project', 'p1', 'org1')).toBe('/orgs/org1/projects/p1');
    expect(mentionHref('initiative', 'i1', 'org1')).toBe('/orgs/org1/initiatives/i1');
    expect(mentionHref('program', 'g1', 'org1')).toBe('/orgs/org1/programs/g1');
    expect(mentionHref('cycle', 'c1', 'org1')).toBe('/orgs/org1/cycles/c1');
  });
});
