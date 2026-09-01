import '@testing-library/jest-dom/vitest';

import type { TemplateOut } from '@docket/work/template-contract';
import { assertDefined } from '@docket/test-utils';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDescriptionTemplateContribution,
  TemplateAwareEntityDocument,
} from '@/components/editor/apply-description-template';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { queryKeys } from '@/lib/query';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: 'org_1' }),
  useActiveOrgIdOptional: () => 'org_1',
  useActiveOrg: () => ({ activeOrgId: 'org_1' }),
}));

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe(): void {
      // Layout does not exist in jsdom.
    }
    disconnect(): void {
      // No observation was registered.
    }
    unobserve(): void {
      // No observation was registered.
    }
    takeRecords(): [] {
      return [];
    }
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
  },
);

function focusEditorAtEnd(surface: HTMLElement): void {
  surface.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(surface);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

installProseMirrorLayoutShims();

afterEach(cleanup);

/** A persisted Initiative template with a body that can be inserted into an editor. */
const STRATEGIC_INITIATIVE = {
  id: 'template_1',
  organizationId: 'org_1',
  targetType: 'initiative',
  name: 'Strategic Initiative',
  description: 'A direction with a way to tell if it worked.',
  scope: 'organization',
  ownerActorId: null,
  teamId: null,
  payload: {
    targetType: 'initiative',
    description: '# Executive Summary\n\n## Overview',
  },
  isSeed: true,
  createdAt: '2026-08-20T00:00:00.000Z',
} as unknown as TemplateOut;

/** Build one task template for scope-filtering and persisted-editor integration tests. */
function taskTemplate(
  id: string,
  name: string,
  scope: TemplateOut['scope'],
  ownerActorId: string | null = null,
  teamId: string | null = null,
): TemplateOut {
  return {
    ...STRATEGIC_INITIATIVE,
    id,
    targetType: 'task',
    name,
    scope,
    ownerActorId,
    teamId,
    payload: { targetType: 'task', description: `## ${name}` },
  } as unknown as TemplateOut;
}

/** Render a real editor with the Initiative template contribution installed. */
function renderTemplateEditor(value: string, onChange = vi.fn()) {
  const { wrapper: Wrapper } = makeQueryWrapper();
  const contribution = createDescriptionTemplateContribution({
    kind: 'initiative',
    templates: [STRATEGIC_INITIATIVE],
    manageHref: '/orgs/org_1/settings/templates',
  });
  return {
    ...render(
      <Wrapper>
        <FreeformTextEditor
          value={value}
          onChange={onChange}
          placeholder="Add the Initiative brief…"
          ariaLabel="Description"
          contributions={[contribution]}
        />
      </Wrapper>,
    ),
    onChange,
  };
}

/** Render the query-backed persisted Task editor against a seeded template cache. */
function renderTemplateAwareTaskEditor({
  value = '',
  canEdit = true,
  templates,
}: {
  readonly value?: string;
  readonly canEdit?: boolean;
  readonly templates: readonly TemplateOut[];
}) {
  const { client, wrapper: Wrapper } = makeQueryWrapper();
  const onSave = vi.fn();
  client.setQueryData(queryKeys.templatesOfKind('org_1', 'task'), { items: templates });
  return {
    ...render(
      <Wrapper>
        <TemplateAwareEntityDocument
          orgId="org_1"
          kind="task"
          currentActorId="actor_current"
          teamId="team_current"
          value={value}
          canEdit={canEdit}
          onSave={onSave}
          placeholder="Add a description"
          contents={false}
        />
      </Wrapper>,
    ),
    onSave,
  };
}

describe('description templates inside an existing entity editor', () => {
  it('shows Start from template only while the editor is empty', async () => {
    const user = userEvent.setup();
    renderTemplateEditor('');

    const surface = await screen.findByRole('textbox', { name: 'Description' });
    const action = await screen.findByRole('button', { name: 'Start from template' });
    const editorSurface = assertDefined(action.closest('[data-editor-surface]'));
    expect(editorSurface).toContainElement(surface);
    expect(editorSurface).toHaveClass('flex-1');
    expect(surface).toHaveClass('flex-1');
    const emptyState = assertDefined(action.closest('[data-editor-empty-actions]'));
    expect(emptyState).toHaveTextContent('Add the Initiative brief…');
    expect(emptyState).toHaveTextContent('Start from template');
    expect(emptyState).toHaveClass('inline-flex', 'top-4', 'left-4', 'flex-nowrap');
    expect(emptyState).not.toHaveClass('top-8');
    expect(action).toHaveClass('border-outline-variant', 'border', 'rounded-full');

    await user.click(surface);
    await user.keyboard('A direction I wrote');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Start from template' })).not.toBeInTheDocument();
    });
  });

  it('starts an empty editor from a template without a scope header', async () => {
    const { onChange } = renderTemplateEditor('');

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Start from template' }), {
      button: 0,
    });
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Strategic Initiative/ }));

    const surface = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => {
      expect(surface).toHaveTextContent('Executive Summary');
      expect(String(onChange.mock.calls.at(-1)?.[0] ?? '').trim()).toBe(
        '# Executive Summary\n\n## Overview',
      );
    });
    expect(screen.queryByRole('button', { name: 'Start from template' })).not.toBeInTheDocument();
  });

  it('preserves unsaved text when /template appends through the query-backed editor', async () => {
    const user = userEvent.setup();
    const template = taskTemplate('template_task', 'Task Template', 'organization');
    const { onSave } = renderTemplateAwareTaskEditor({
      value: 'Persisted notes',
      templates: [template],
    });
    expect(screen.queryByRole('button', { name: 'Start from template' })).not.toBeInTheDocument();

    const surface = await screen.findByRole('textbox', { name: 'Description' });
    act(() => {
      focusEditorAtEnd(surface);
    });
    await user.keyboard(' plus unsaved detail{Enter}/');

    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    expect(within(menu).queryByRole('option', { name: /Task Template/ })).toBeNull();
    await user.keyboard('template');
    const option = within(menu).getByRole('option', { name: /Task Template/ });
    expect(option).toBeVisible();
    expect(surface).toHaveAttribute('aria-activedescendant', option.id);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(surface).toHaveTextContent('Persisted notes plus unsaved detail');
      expect(surface).toHaveTextContent('Task Template');
      expect(surface).not.toHaveTextContent('/template');
    });
    fireEvent.blur(surface);
    expect(onSave).toHaveBeenLastCalledWith(
      'Persisted notes plus unsaved detail\n\n## Task Template',
    );
  });

  it('applies a /template option without moving focus before the pointer selection lands', async () => {
    const user = userEvent.setup();
    renderTemplateAwareTaskEditor({
      value: 'Persisted notes',
      templates: [taskTemplate('template_task', 'Task Template', 'organization')],
    });
    const surface = await screen.findByRole('textbox', { name: 'Description' });
    act(() => {
      focusEditorAtEnd(surface);
    });
    await user.keyboard('{Enter}/template');
    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });

    fireEvent.mouseDown(within(menu).getByRole('option', { name: /Task Template/ }));

    await waitFor(() => {
      expect(surface).toHaveTextContent('Persisted notes');
      expect(surface).toHaveTextContent('Task Template');
      expect(screen.queryByRole('listbox', { name: 'Insert a block' })).not.toBeInTheDocument();
    });
  });

  it('persists template code-block semantics and terminal hard-break spaces', async () => {
    const formatted = {
      ...taskTemplate('formatted', 'Formatted Template', 'organization'),
      payload: {
        targetType: 'task',
        description: '    const answer = 42\n\nFirst line  ',
      },
    } as TemplateOut;
    const { onSave } = renderTemplateAwareTaskEditor({ templates: [formatted] });

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Start from template' }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Formatted Template/ }));
    const surface = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(surface).toHaveTextContent('const answer = 42'));
    fireEvent.blur(surface);

    // Tiptap normalizes an indented Markdown code block to an equivalent fenced block. The save
    // boundary must preserve that serialized document, including the terminal hard-break spaces.
    expect(onSave).toHaveBeenLastCalledWith('```\nconst answer = 42\n```\n\nFirst line  ');
  });

  it('filters the query-backed menu to organization, matching-team, and own templates', async () => {
    renderTemplateAwareTaskEditor({
      templates: [
        taskTemplate('org', 'Organization template', 'organization'),
        taskTemplate('team', 'Matching team template', 'team', null, 'team_current'),
        taskTemplate('wrong-team', 'Wrong team template', 'team', null, 'team_other'),
        taskTemplate('mine', 'My template', 'personal', 'actor_current'),
        taskTemplate('theirs', 'Their template', 'personal', 'actor_other'),
      ],
    });

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Start from template' }), {
      button: 0,
    });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Organization template/ })).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: /Matching team template/ })).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: /My template/ })).toBeVisible();
    expect(within(menu).queryByRole('menuitem', { name: /Wrong team template/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Their template/ })).toBeNull();
    expect(within(menu).queryByText('Workspace')).toBeNull();
  });

  it('does not expose template actions in a read-only document', async () => {
    renderTemplateAwareTaskEditor({
      canEdit: false,
      templates: [taskTemplate('org', 'Organization template', 'organization')],
    });

    expect(await screen.findByText('Add a description')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start from template' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
  });
});
