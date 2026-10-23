import '@testing-library/jest-dom/vitest';
import { TabsScope } from '@docket/ui/primitives';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InitiativeHierarchyLinkId, InitiativeId } from '@docket/work/ids';
import { OrganizationId } from '@docket/identity-access/ids';

import type { ConnectedWorkActions } from '../../../src/components/initiatives/initiative-connected-work';
import { InitiativeRelationshipPanels } from '../../../src/components/initiatives/initiative-relationship-panels';
import { InteractionProvider } from '../../../src/lib/actions/interaction-provider';
import { createActionRegistry, defineActionDomain } from '../../../src/lib/actions/registry';
import type { ActionContext } from '../../../src/lib/actions/types';

const childId = InitiativeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const organizationId = OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const parentInitiativeId = InitiativeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const parentLinkId = InitiativeHierarchyLinkId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY');

const child = {
  id: childId,
  organizationId,
  organizationName: 'Docket',
  name: 'Membership portal',
  status: 'active' as const,
  health: 'on_track' as const,
  crossWorkspace: false,
  parentInitiativeId,
  parentLinkId,
};

const project = {
  kind: 'project' as const,
  id: 'project-1',
  organizationId,
  name: 'Urbanist tech program startup',
  summary: 'Stand the program up end to end.',
  status: 'active',
  health: 'on_track' as const,
  direct: false,
  inheritedThroughInitiativeId: childId,
  programId: null,
};

/** A read-only viewer: every create, link, and unlink control stays off these panels. */
const readOnlyActions: ConnectedWorkActions = {
  canEdit: false,
  busy: false,
  projectOptions: [],
  projectProgramIds: new Map(),
  programOptions: [],
  optionsLoading: false,
  onLinkProject: () => undefined,
  onLinkProgram: () => undefined,
  onUnlink: () => undefined,
  onCreateProject: () => undefined,
  onQuickAddProject: async () => undefined,
};

/** Render under a query client, which the Connected work panel's icon lookup needs. */
function renderPanels(ui: Parameters<typeof render>[0]): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TabsScope>{ui}</TabsScope>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('InitiativeRelationshipPanels', () => {
  it('renders sub-initiatives as complete Initiative objects with an explicit add path', async () => {
    const onAddSubinitiative = vi.fn();
    renderPanels(
      <InitiativeRelationshipPanels
        tab="subinitiatives"
        routeOrganizationId={organizationId}
        initiativeId={childId}
        children={[child]}
        connectedWork={[project]}
        initiativeNoun="Initiative"
        programNoun="Program"
        projectNoun="Project"
        onAddSubinitiative={onAddSubinitiative}
        connectedWorkActions={readOnlyActions}
        initiativePlural="Initiatives"
        truncated={false}
      />,
    );

    const row = screen.getByTestId('object-list-row');
    expect(row).toHaveAttribute('data-object-kind', 'initiative');
    expect(row).toHaveAttribute(
      'data-object-meta',
      JSON.stringify({ parentInitiativeId, parentLinkId }),
    );
    expect(screen.getByRole('link', { name: 'Membership portal' })).toHaveAttribute(
      'href',
      `/orgs/${organizationId}/initiatives/${childId}`,
    );
    expect(screen.queryByText('Urbanist tech program startup')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add sub-initiative' }));
    expect(onAddSubinitiative).toHaveBeenCalledOnce();
  });

  it('renders connected work as the Project or Program object it actually is', () => {
    renderPanels(
      <InitiativeRelationshipPanels
        tab="work"
        routeOrganizationId={organizationId}
        initiativeId={childId}
        children={[child]}
        connectedWork={[project]}
        initiativeNoun="Initiative"
        programNoun="Program"
        projectNoun="Project"
        onAddSubinitiative={vi.fn()}
        connectedWorkActions={readOnlyActions}
        initiativePlural="Initiatives"
        truncated={false}
      />,
    );

    const row = screen.getByTestId('object-list-row');
    expect(row).toHaveAttribute('data-object-kind', 'project');
    expect(screen.getByRole('link', { name: 'Urbanist tech program startup' })).toHaveAttribute(
      'href',
      `/orgs/${organizationId}/projects/project-1`,
    );
    // The icon says it is a Project; the line under the name is the summary someone wrote, with
    // the one fact the row cannot show otherwise — that this link came from a sub-initiative.
    expect(screen.getByText('Inherited · Stand the program up end to end.')).toBeVisible();
    expect(screen.queryByText('Project · inherited')).toBeNull();
    expect(screen.queryByText('Membership portal')).not.toBeInTheDocument();
  });

  it('keeps a foreign hierarchy row owner-scoped and reference-only through the context-menu provider', async () => {
    const seen: ActionContext[] = [];
    const registry = createActionRegistry();
    registry.register(
      'initiative',
      defineActionDomain('initiative', [
        {
          id: 'initiative.open',
          label: 'Open initiative',
          objectKinds: ['initiative'],
          run: (context) => {
            seen.push(context);
          },
        },
        {
          id: 'initiative.copy',
          label: 'Copy initiative link',
          objectKinds: ['initiative'],
          run: () => undefined,
        },
        {
          id: 'initiative.changeParent',
          label: 'Change parent…',
          objectKinds: ['initiative'],
          run: () => undefined,
        },
      ]),
    );
    const foreignOrganizationId = OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAZ');

    renderPanels(
      <InteractionProvider registry={registry}>
        <InitiativeRelationshipPanels
          tab="subinitiatives"
          routeOrganizationId={organizationId}
          initiativeId={childId}
          children={[
            {
              ...child,
              organizationId: foreignOrganizationId,
              organizationName: 'Partner workspace',
              crossWorkspace: true,
            },
          ]}
          connectedWork={[]}
          initiativeNoun="Initiative"
          programNoun="Program"
          projectNoun="Project"
          onAddSubinitiative={vi.fn()}
          connectedWorkActions={readOnlyActions}
          initiativePlural="Initiatives"
          truncated={false}
        />
      </InteractionProvider>,
    );

    const row = screen.getByTestId('object-list-row');
    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });

    expect(await screen.findByRole('menuitem', { name: 'Open initiative' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Copy initiative link' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Change parent…' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open initiative' }));
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]).toMatchObject({
      organizationId: foreignOrganizationId,
      actionScope: 'reference',
      objects: [{ id: childId, organizationId: foreignOrganizationId }],
    });
  });

  it('keeps foreign connected work owner-scoped, reference-only, and non-draggable', async () => {
    const seen: ActionContext[] = [];
    const registry = createActionRegistry();
    registry.register(
      'project',
      defineActionDomain('project', [
        {
          id: 'project.open',
          label: 'Open project',
          objectKinds: ['project'],
          run: (context) => {
            seen.push(context);
          },
        },
        {
          id: 'project.copy',
          label: 'Copy project link',
          objectKinds: ['project'],
          run: () => undefined,
        },
        {
          id: 'project.changeStatus',
          label: 'Change project status',
          objectKinds: ['project'],
          run: () => undefined,
        },
      ]),
    );
    const foreignOrganizationId = OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAZ');

    renderPanels(
      <InteractionProvider registry={registry}>
        <InitiativeRelationshipPanels
          tab="work"
          routeOrganizationId={organizationId}
          initiativeId={childId}
          children={[]}
          connectedWork={[{ ...project, organizationId: foreignOrganizationId }]}
          initiativeNoun="Initiative"
          programNoun="Program"
          projectNoun="Project"
          onAddSubinitiative={vi.fn()}
          connectedWorkActions={readOnlyActions}
          initiativePlural="Initiatives"
          truncated={false}
        />
      </InteractionProvider>,
    );

    const row = screen.getByTestId('object-list-row');
    expect(row).toHaveAttribute('data-object-action-scope', 'reference');
    expect(row).not.toHaveClass('cursor-grab');
    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });

    expect(await screen.findByRole('menuitem', { name: 'Open project' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Copy project link' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Change project status' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open project' }));
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]).toMatchObject({
      organizationId: foreignOrganizationId,
      actionScope: 'reference',
      objects: [{ id: project.id, organizationId: foreignOrganizationId }],
    });
  });
});
