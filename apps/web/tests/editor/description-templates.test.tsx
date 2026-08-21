import '@testing-library/jest-dom/vitest';

import type { TemplateOut } from '@docket/types';
import { assertDefined } from '@docket/test-utils';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDescriptionTemplateContribution } from '@/components/editor/apply-description-template';
import { FreeformTextEditor } from '@/components/editor/freeform-text';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: 'org_1' }),
  useActiveOrgIdOptional: () => 'org_1',
  useActiveOrg: () => ({ activeOrgId: 'org_1' }),
}));

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

describe('description templates inside an existing entity editor', () => {
  it('shows Start from template only while the editor is empty', async () => {
    const user = userEvent.setup();
    renderTemplateEditor('');

    const surface = await screen.findByRole('textbox', { name: 'Description' });
    const action = await screen.findByRole('button', { name: 'Start from template' });
    expect(assertDefined(action.closest('[data-editor-surface]'))).toContainElement(surface);

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

  it('offers templates through /template after content exists and appends the chosen body', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTemplateEditor('Existing notes');
    expect(screen.queryByRole('button', { name: 'Start from template' })).not.toBeInTheDocument();

    const surface = await screen.findByRole('textbox', { name: 'Description' });
    fireEvent.mouseDown(assertDefined(surface.closest<HTMLElement>('[data-editor-surface]')));
    await waitFor(() => expect(surface).toHaveFocus());
    await user.keyboard('{Enter}/');

    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    expect(within(menu).queryByRole('option', { name: /Strategic Initiative/ })).toBeNull();
    await user.keyboard('template');
    const option = within(menu).getByRole('option', { name: /Strategic Initiative/ });
    expect(option).toBeVisible();
    expect(surface).toHaveAttribute('aria-activedescendant', option.id);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(surface).toHaveTextContent('Existing notes');
      expect(surface).toHaveTextContent('Executive Summary');
      expect(surface).not.toHaveTextContent('/template');
      expect(String(onChange.mock.calls.at(-1)?.[0] ?? '').trim()).toBe(
        'Existing notes\n\n# Executive Summary\n\n## Overview',
      );
    });
  });
});
