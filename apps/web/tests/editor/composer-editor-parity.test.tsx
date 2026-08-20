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
        bodyPlaceholder="Add a description…"
        mentionOrgId="org_1"
        creating={false}
        canSubmit={false}
        onSubmit={vi.fn()}
        submitLabel="Create project"
      >
        <div />
      </ComposerShell>,
    );

    const body = await screen.findByRole('textbox', { name: 'Add a description…' });
    await user.click(body);
    await user.keyboard('/quo');

    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    expect(within(menu).getByRole('option')).toHaveTextContent('Quote');
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
          bodyPlaceholder="Add a description…"
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
    const body = await screen.findByRole('textbox', { name: 'Add a description…' });
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
    expect(screen.getByRole('textbox', { name: 'Add a description…' })).toBe(sameBody);
    expect(sameBody.textContent).toContain('Durable');
    expect(sameBody.textContent).toContain('@road');
    expect(sameBody.textContent).toContain('@next');
  });
});
