import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mentionSearch, mentionExternal, mentionHydrate } = vi.hoisted(() => ({
  mentionSearch: vi.fn(),
  mentionExternal: vi.fn(),
  mentionHydrate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          mentions: {
            search: { $get: mentionSearch },
            external: { $get: mentionExternal },
            hydrate: { $post: mentionHydrate },
          },
        },
      },
    },
  },
}));

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => null,
  useActiveOrgIdOptional: () => null,
  useActiveOrg: () => ({ activeOrgId: 'org_1' }),
}));

import { ComposerShell } from '@/components/composer/composer-shell';

import { jsonResponse } from '../support/http';
import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

installProseMirrorLayoutShims();

beforeEach(() => {
  mentionSearch.mockReset().mockImplementation(({ param }: { param: { orgId: string } }) =>
    Promise.resolve(
      jsonResponse(true, {
        items: [
          {
            origin: 'local',
            id: `task_${param.orgId}`,
            ref: { kind: 'entity', entityKind: 'task', entityId: `task_${param.orgId}` },
            entityKind: 'task',
            title: `Roadmap in ${param.orgId}`,
            subtitle: null,
            href: `/orgs/${param.orgId}/tasks/task_${param.orgId}`,
            score: 1,
          },
        ],
      }),
    ),
  );
  mentionExternal.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  mentionHydrate.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
});

afterEach(cleanup);

function renderEditor(ui: ReactElement): void {
  const { wrapper: Wrapper } = makeQueryWrapper();
  render(<Wrapper>{ui}</Wrapper>);
}

describe('composer body editor parity', () => {
  it('uses the compact shell, two stable footer rows, and shared control geometry', async () => {
    const user = userEvent.setup();
    renderEditor(
      <ComposerShell
        open
        onOpenChange={vi.fn()}
        heading="New initiative"
        title=""
        onTitleChange={vi.fn()}
        titlePlaceholder="Initiative name"
        summary=""
        onSummaryChange={vi.fn()}
        summaryPlaceholder="One-sentence summary"
        body=""
        onBodyChange={vi.fn()}
        bodyPlaceholder="Add a description"
        continuation={{ checked: false, onCheckedChange: vi.fn(), onSubmit: vi.fn() }}
        creating={false}
        canSubmit={false}
        onSubmit={vi.fn()}
        submitLabel="Create Initiative"
      >
        <button type="button">No health</button>
      </ComposerShell>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'New initiative' });
    const title = screen.getByRole('textbox', { name: 'Initiative name' });
    const summary = screen.getByRole('textbox', { name: 'One-sentence summary' });
    const create = screen.getByRole('button', { name: 'Create Initiative' });
    const actionRow = create.parentElement;
    const footer = actionRow?.parentElement;
    const expand = screen.getByRole('button', { name: 'Expand editor' });
    const createMore = screen.getByRole('switch', { name: 'Create more' });

    expect(dialog).toHaveClass('max-w-2xl', 'h-[min(60dvh,36rem)]');
    expect(title).toHaveClass('text-headline-small');
    expect(title).not.toHaveClass('text-lg', 'font-medium', 'tracking-tight');
    expect(summary).toHaveClass('text-body-large');
    expect(actionRow).toHaveClass('w-full');
    expect(footer).toHaveClass('sm:flex-col', 'sm:items-stretch', 'sm:justify-start');
    expect(create).toHaveClass(
      'disabled:bg-surface-container-highest',
      'disabled:text-on-surface-variant',
      'disabled:opacity-100',
    );
    expect(expand).toHaveClass('h-7', 'w-7', 'coarse:h-10', 'coarse:w-10');
    expect(createMore).toHaveClass('coarse:min-h-10');
    expect(expand.querySelector('[data-testid="OpenInFullIcon"]')).not.toBeNull();

    await user.click(expand);

    expect(dialog).toHaveClass('max-w-5xl', 'h-[min(80dvh,48rem)]');
    expect(screen.getByRole('button', { name: 'Collapse editor' })).toContainElement(
      document.querySelector('[data-testid="CloseFullscreenIcon"]'),
    );
  });

  it('renders a composer contribution in the shared inline empty state', async () => {
    renderEditor(
      <ComposerShell
        open
        onOpenChange={vi.fn()}
        heading="New project"
        title=""
        onTitleChange={vi.fn()}
        titlePlaceholder="Project name"
        body=""
        onBodyChange={vi.fn()}
        bodyPlaceholder="Add a description"
        bodyContributions={[
          {
            id: 'template-action',
            renderEmptyAction: () => <button type="button">Start from template</button>,
          },
        ]}
        creating={false}
        canSubmit={false}
        onSubmit={vi.fn()}
        submitLabel="Create project"
      >
        <div />
      </ComposerShell>,
    );

    const action = await screen.findByRole('button', { name: 'Start from template' });
    const emptyState = action.closest('[data-editor-empty-actions]');
    expect(emptyState).toHaveTextContent('Add a description');
    expect(emptyState).toContainElement(action);
    expect(emptyState).toHaveClass('flex-col', 'items-start');
  });

  it('keeps slash commands enabled inside the shared composer', async () => {
    const user = userEvent.setup();
    renderEditor(
      <ComposerShell
        open
        onOpenChange={vi.fn()}
        heading="New project"
        title=""
        onTitleChange={vi.fn()}
        titlePlaceholder="Project name"
        body=""
        onBodyChange={vi.fn()}
        bodyPlaceholder="Add a description"
        mentionOrgId="org_1"
        creating={false}
        canSubmit={false}
        onSubmit={vi.fn()}
        submitLabel="Create project"
      >
        <div />
      </ComposerShell>,
    );

    const body = await screen.findByRole('textbox', { name: 'Add a description' });
    await user.click(body);
    await user.keyboard('/quo');

    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    expect(within(menu).getByRole('option', { name: /Quote/ })).toBeVisible();
  });

  it('retargets mention search to the selected workspace without replacing the draft', async () => {
    const user = userEvent.setup();

    function Harness(): ReactElement {
      const [orgId, setOrgId] = useState('org_1');
      const [body, setBody] = useState('Durable ');
      return (
        <ComposerShell
          open
          onOpenChange={vi.fn()}
          heading="New project"
          title="Roadmap"
          onTitleChange={vi.fn()}
          titlePlaceholder="Project name"
          body={body}
          onBodyChange={setBody}
          bodyPlaceholder="Add a description"
          mentionOrgId={orgId}
          creating={false}
          canSubmit
          onSubmit={vi.fn()}
          submitLabel="Create project"
        >
          <button
            type="button"
            onClick={() => {
              setOrgId('org_2');
            }}
          >
            Retarget workspace
          </button>
        </ComposerShell>
      );
    }

    renderEditor(<Harness />);
    const body = await screen.findByRole('textbox', { name: 'Add a description' });
    await user.click(body);
    await user.keyboard('@road');

    await waitFor(() => {
      expect(mentionSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          param: { orgId: 'org_1' },
          query: expect.objectContaining({ q: 'road' }),
        }),
      );
    });
    const sameBody = body;
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Retarget workspace' }));
    await user.click(body);
    await user.keyboard(' @next');

    await waitFor(() => {
      expect(mentionSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          param: { orgId: 'org_2' },
          query: expect.objectContaining({ q: 'next' }),
        }),
      );
    });
    expect(screen.getByRole('textbox', { name: 'Add a description' })).toBe(sameBody);
    expect(sameBody.textContent).toContain('Durable');
    expect(sameBody.textContent).toContain('@road');
    expect(sameBody.textContent).toContain('@next');
  });

  it('keeps the mention picker open through a full name and a settled no-match state', async () => {
    const user = userEvent.setup();
    mentionSearch.mockImplementation(({ query }: { query: { q: string } }) =>
      Promise.resolve(
        jsonResponse(true, {
          query: query.q,
          items:
            query.q === 'Roadmap in org_1'
              ? [
                  {
                    origin: 'local',
                    id: 'task_org_1',
                    ref: { kind: 'entity', entityKind: 'task', entityId: 'task_org_1' },
                    entityKind: 'task',
                    title: 'Roadmap in org_1',
                    subtitle: null,
                    href: '/orgs/org_1/tasks/task_org_1',
                    score: 1,
                  },
                ]
              : [],
        }),
      ),
    );

    renderEditor(
      <ComposerShell
        open
        onOpenChange={vi.fn()}
        heading="New project"
        title=""
        onTitleChange={vi.fn()}
        titlePlaceholder="Project name"
        body=""
        onBodyChange={vi.fn()}
        bodyPlaceholder="Add a description"
        mentionOrgId="org_1"
        creating={false}
        canSubmit={false}
        onSubmit={vi.fn()}
        submitLabel="Create project"
      >
        <div />
      </ComposerShell>,
    );

    const body = await screen.findByRole('textbox', { name: 'Add a description' });
    await user.click(body);
    await user.keyboard('@Roadmap in org_1');

    expect(await screen.findByRole('option', { name: /Roadmap in org_1/ })).toBeVisible();

    await user.keyboard(' missing');

    expect(await screen.findByText('No matches for “Roadmap in org_1 missing”')).toBeVisible();
    expect(screen.getByRole('listbox', { name: 'Mention a resource' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
  });
});
