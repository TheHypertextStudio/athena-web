import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InitiativeConnectedWork } from '@docket/work/initiative-contract';
import { InitiativeId, ProgramId } from '@docket/work/ids';
import { OrganizationId } from '@docket/identity-access/ids';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { InteractionProvider } from '../../../src/lib/actions/interaction-provider';
import {
  type ConnectedWorkActions,
  groupConnectedWork,
  InitiativeConnectedWorkPanel,
} from '../../../src/components/initiatives/initiative-connected-work';

const organizationId = OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const subinitiativeId = InitiativeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const platformId = ProgramId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0');
const unlinkedProgramId = ProgramId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1');

/** One connected-work row with the shared workspace and sensible defaults. */
function row(overrides: Partial<InitiativeConnectedWork>): InitiativeConnectedWork {
  return {
    kind: 'project',
    id: 'project-1',
    organizationId,
    name: 'Fare policy',
    summary: 'Cap what a rider pays in a day.',
    status: 'active',
    health: 'on_track',
    direct: true,
    inheritedThroughInitiativeId: null,
    programId: null,
    ...overrides,
  };
}

const platform = row({ kind: 'program', id: platformId, name: 'Platform', programId: null });
const inPlatform = row({ id: 'project-1', name: 'Fare policy', programId: platformId });
const inUnlinkedProgram = row({
  id: 'project-2',
  name: 'Depot rebuild',
  programId: unlinkedProgramId,
});
const loose = row({ id: 'project-3', name: 'Signage audit', programId: null });

/** Editable actions with every callback spied. */
function editableActions(overrides: Partial<ConnectedWorkActions> = {}): ConnectedWorkActions {
  return {
    canEdit: true,
    busy: false,
    projectProgramIds: new Map([['project-9', null]]),
    projectOptions: [{ value: 'project-9', label: 'Ridership model' }],
    programOptions: [{ value: unlinkedProgramId, label: 'Operations' }],
    optionsLoading: false,
    onLinkProject: vi.fn(),
    onLinkProgram: vi.fn(),
    onUnlink: vi.fn(),
    onCreateProject: vi.fn(),
    onQuickAddProject: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Render the panel with the shared nouns. */
function renderPanel(
  connectedWork: readonly InitiativeConnectedWork[],
  actions: ConnectedWorkActions,
): ReturnType<typeof render> {
  // The panel reads the workspace's customized Project and Program icons. Nothing answers here,
  // so the lookup stays empty and every row falls back to its kind glyph — which is the behaviour
  // these tests are about.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InteractionProvider>
        <InitiativeConnectedWorkPanel
          routeOrganizationId={organizationId}
          initiativeId={subinitiativeId}
          connectedWork={connectedWork}
          loading={false}
          initiativeNoun="Initiative"
          programNoun="Program"
          projectNoun="Project"
          actions={actions}
        />
      </InteractionProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('groupConnectedWork', () => {
  it('files a project under its program only when that program is linked too', () => {
    const groups = groupConnectedWork([platform, inPlatform, inUnlinkedProgram, loose]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.program?.id).toBe(platformId);
    expect(groups[0]?.projects.map((project) => project.id)).toEqual(['project-1']);
    expect(groups[1]?.program).toBeNull();
    expect(groups[1]?.projects.map((project) => project.id)).toEqual(['project-2', 'project-3']);
  });

  it('always returns the ungrouped bucket, so the panel keeps somewhere to type', () => {
    expect(groupConnectedWork([])).toEqual([{ program: null, projects: [] }]);
    expect(groupConnectedWork([platform])).toEqual([
      { program: platform, projects: [] },
      { program: null, projects: [] },
    ]);
  });
});

describe('InitiativeConnectedWorkPanel', () => {
  it('does not submit or navigate suggestions while a name is being composed with an IME', async () => {
    const actions = editableActions();
    renderPanel([loose], actions);
    const field = screen.getByRole('combobox', { name: 'Add or link a project' });
    await userEvent.type(field, 'Dinner');
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(actions.onQuickAddProject).not.toHaveBeenCalled();
    expect(field).toHaveValue('Dinner');
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
    expect(actions.onQuickAddProject).toHaveBeenCalledWith('Dinner', null);
  });

  it('offers only existing projects already filed in the destination Program', async () => {
    const actions = editableActions({
      projectOptions: [
        { value: 'project-9', label: 'Ridership model' },
        { value: 'project-10', label: 'Rider service' },
      ],
      projectProgramIds: new Map([
        ['project-9', null],
        ['project-10', platformId],
      ]),
    });
    renderPanel([platform, inPlatform], actions);
    const field = screen.getByPlaceholderText('Add to Platform…');
    await userEvent.type(field, 'Rider');
    expect(screen.queryByRole('option', { name: /Ridership model/ })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: /Rider service/ }));
    expect(actions.onLinkProject).toHaveBeenCalledWith('project-10');
  });

  it('keeps typing focus and exposes the keyboard-selected existing match', async () => {
    const actions = editableActions();
    renderPanel([loose], actions);
    const field = screen.getByRole('combobox', { name: 'Add or link a project' });
    await userEvent.type(field, 'Rider{ArrowDown}');
    const option = screen.getByRole('option', { name: /Ridership model/ });
    expect(field).toHaveFocus();
    expect(option).toHaveAttribute('data-active', 'true');
    expect(option).toHaveAttribute('aria-selected', 'false');
    expect(field).toHaveAttribute('aria-activedescendant', option.id);
    expect(option.id).not.toBe('');
    await userEvent.keyboard('{Enter}');
    expect(actions.onLinkProject).toHaveBeenCalledWith('project-9');
    expect(actions.onQuickAddProject).not.toHaveBeenCalled();
  });

  it('dismisses existing matches on an outside interaction without losing the typed name', async () => {
    renderPanel([loose], editableActions());
    const field = screen.getByRole('combobox', { name: 'Add or link a project' });
    await userEvent.type(field, 'Rider');
    expect(screen.getByRole('option', { name: /Ridership model/ })).toBeVisible();
    await userEvent.click(screen.getByText('Cap what a rider pays in a day.'));
    expect(screen.queryByRole('option')).toBeNull();
    expect(field).toHaveValue('Rider');
  });

  it('keeps rejected project names available for retry while accepting the next entry', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider text'))
      .mockResolvedValue(undefined);
    renderPanel([loose], editableActions({ onQuickAddProject: create }));
    const field = screen.getByRole('combobox', { name: 'Add or link a project' });
    await userEvent.type(field, 'Venue{Enter}');
    expect(await screen.findByText('Venue')).toBeVisible();
    expect(screen.queryByText('provider text')).toBeNull();
    await userEvent.type(field, 'Catering{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Retry adding Venue' }));
    expect(create.mock.calls).toEqual([
      ['Venue', null],
      ['Catering', null],
      ['Venue', null],
    ]);
    expect(screen.queryByText('Venue')).toBeNull();
  });

  it('sends the containing program with a name typed inside that program group', async () => {
    const actions = editableActions();
    renderPanel([platform, inPlatform, loose], actions);

    const inGroup = screen.getByPlaceholderText('Add to Platform…');
    await userEvent.type(inGroup, 'Fare capping{Enter}');
    expect(actions.onQuickAddProject).toHaveBeenCalledWith('Fare capping', platformId);

    const looseRow = screen.getByPlaceholderText('Add a project…');
    await userEvent.type(looseRow, 'Signage phase 2{Enter}');
    expect(actions.onQuickAddProject).toHaveBeenCalledWith('Signage phase 2', null);
  });

  it('offers what already exists as you type, and links it instead of creating a duplicate', async () => {
    const actions = editableActions({
      projectOptions: [{ value: 'project-9', label: 'Ridership model' }],
    });
    renderPanel([loose], actions);

    const field = screen.getByPlaceholderText('Add a project…');
    await userEvent.type(field, 'Ridership');

    const option = screen.getByRole('option', { name: /Ridership model/ });
    expect(option).toBeVisible();
    await userEvent.click(option);
    expect(actions.onLinkProject).toHaveBeenCalledWith('project-9');
    expect(actions.onQuickAddProject).not.toHaveBeenCalled();
    expect(field).toHaveValue('');
  });

  it('creates when nothing matches, and keeps the field for the next one', async () => {
    const actions = editableActions();
    renderPanel([loose], actions);

    const field = screen.getByPlaceholderText('Add a project…');
    await userEvent.type(field, 'Nothing like this exists{Enter}');
    expect(actions.onQuickAddProject).toHaveBeenCalledWith('Nothing like this exists', null);
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });

  it('offers programs only outside a program, because a program does not nest in one', async () => {
    const actions = editableActions({
      programOptions: [{ value: unlinkedProgramId, label: 'Operations' }],
    });
    renderPanel([platform, inPlatform, loose], actions);

    const looseField = screen.getByPlaceholderText('Add a project…');
    await userEvent.type(looseField, 'Oper');
    expect(screen.getByRole('option', { name: /Operations/ })).toBeVisible();

    // Clear it, or its own open list would answer the next query.
    await userEvent.clear(looseField);
    await userEvent.type(screen.getByPlaceholderText('Add to Platform…'), 'Oper');
    expect(screen.queryByRole('option', { name: /Operations/ })).toBeNull();
  });

  it('states what each row is for, and never repeats the word Project down the column', () => {
    renderPanel([loose], editableActions());

    expect(screen.getByText('Cap what a rider pays in a day.')).toBeVisible();
    expect(screen.queryByText('Project')).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('says when a row was inherited rather than linked here', () => {
    const inherited = row({
      id: 'project-4',
      name: 'Inherited work',
      summary: null,
      direct: false,
      inheritedThroughInitiativeId: subinitiativeId,
    });
    const { container } = renderPanel([loose, inherited], editableActions());

    expect(screen.getByText('Inherited')).toBeVisible();
    // Both rows carry the object's own menu — what differs is whether "Remove from this
    // initiative" applies, which the action's own `appliesTo` decides from `directLink`.
    expect(
      container.querySelector('[data-object-id="project-4"]')?.getAttribute('data-object-meta'),
    ).toContain('"directLink":false');
    expect(
      container.querySelector('[data-object-id="project-3"]')?.getAttribute('data-object-meta'),
    ).toContain('"directLink":true');
  });

  it('shows a reader the work and none of the controls', () => {
    const { container } = renderPanel([platform, inPlatform], {
      ...editableActions(),
      canEdit: false,
    });

    expect(screen.getByRole('link', { name: 'Fare policy' })).toBeVisible();
    expect(screen.queryByPlaceholderText('Add a project…')).toBeNull();
    expect(container.querySelector('[placeholder^="Add to"]')).toBeNull();
  });

  it('gives every object in the tree its own menu, not just the nested ones', () => {
    const { container } = renderPanel([platform, inPlatform, loose], editableActions());

    // The Program heading, a Project inside it, and a Project under no Program: all three are
    // objects, so all three carry the object menu.
    for (const name of ['Platform', 'Fare policy', 'Signage audit']) {
      expect(container.querySelector(`[aria-label="${name} actions"]`)).not.toBeNull();
    }
  });

  it('says so plainly when nothing is linked yet', () => {
    renderPanel([], editableActions());

    expect(screen.getByText(/Nothing advances this initiative yet/)).toBeVisible();
    expect(screen.getByPlaceholderText('Add a project…')).toBeVisible();
  });
});
