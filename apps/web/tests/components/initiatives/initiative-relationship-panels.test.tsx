import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Id, InitiativeId, OrganizationId } from '@docket/types';

import { InitiativeRelationshipPanels } from '../../../src/components/initiatives/initiative-relationship-panels';

const childId = InitiativeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const organizationId = OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const parentInitiativeId = InitiativeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const parentLinkId = Id.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY');

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
  status: 'active',
  health: 'on_track' as const,
  direct: false,
  inheritedThroughInitiativeId: childId,
};

afterEach(cleanup);

describe('InitiativeRelationshipPanels', () => {
  it('renders sub-initiatives as complete Initiative objects with an explicit add path', async () => {
    const onAddSubinitiative = vi.fn();
    render(
      <InitiativeRelationshipPanels
        tab="subinitiatives"
        children={[child]}
        connectedWork={[project]}
        initiativeNoun="Initiative"
        programNoun="Program"
        projectNoun="Project"
        onAddSubinitiative={onAddSubinitiative}
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
    render(
      <InitiativeRelationshipPanels
        tab="work"
        children={[child]}
        connectedWork={[project]}
        initiativeNoun="Initiative"
        programNoun="Program"
        projectNoun="Project"
        onAddSubinitiative={vi.fn()}
      />,
    );

    const row = screen.getByTestId('object-list-row');
    expect(row).toHaveAttribute('data-object-kind', 'project');
    expect(screen.getByRole('link', { name: 'Urbanist tech program startup' })).toHaveAttribute(
      'href',
      `/orgs/${organizationId}/projects/project-1`,
    );
    expect(screen.getByText('Project · inherited')).toBeVisible();
    expect(screen.queryByText('Membership portal')).not.toBeInTheDocument();
  });
});
