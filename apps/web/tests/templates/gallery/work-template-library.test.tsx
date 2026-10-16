import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { galleryFixture } from './gallery-fixture';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { WorkTemplateLibrary } from '@/components/templates/gallery/work-template-library';
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
afterEach(cleanup);
let fixtureId = 0;
function definition(
  name: string,
  status: 'draft' | 'published' | 'archived',
  scope: 'personal' | 'team' | 'organization',
  kind: 'project' | 'task' = 'project',
  isBase = false,
) {
  return WorkTemplateOut.parse({
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(fixtureId++).padStart(2, '0')}`,
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    targetType: kind,
    status,
    scope,
    ownerActorId: null,
    teamId: null,
    isBase,
    revision: 0,
    definition: { name, payload: { targetType: kind } },
    offeredTeamIds: [],
    latestVersion:
      status === 'published'
        ? {
            id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
            number: 3,
            workTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
            definition: { name, payload: { targetType: kind } },
            publishedAt: '2026-10-14T00:00:00Z',
            publishedByActorId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
          }
        : null,
    canEdit: true,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
  });
}
describe('organization work library readiness', () => {
  it('resumes actual drafts before ready work and keeps defaults/archive subordinate', () => {
    render(
      <WorkTemplateLibrary
        orgId="org"
        items={[
          definition('Event', 'published', 'organization'),
          definition('Private planning', 'draft', 'personal'),
          definition('Team handover', 'draft', 'team'),
          definition('Blank Project', 'published', 'organization', 'project', true),
          definition('Former event', 'archived', 'organization'),
        ]}
      />,
    );
    expect(
      screen
        .getByRole('heading', { name: 'Continue defining' })
        .compareDocumentPosition(screen.getByRole('heading', { name: 'Ready to use' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Ready to use' })).getByRole('link', {
        name: /Event/,
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Your drafts' })).getByRole('link', {
        name: /Private planning/,
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Team drafts' })).getByRole('link', {
        name: /Team handover/,
      }),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: /Blank Project/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Former event/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Defaults (1)' }));
    expect(screen.getByRole('link', { name: /Blank Project/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    expect(screen.getByRole('link', { name: /Former event/ })).toBeVisible();
  });
  it('does not invent four empty kind groups and preserves meaningful filtered empty state', () => {
    render(<WorkTemplateLibrary orgId="org" items={[]} />);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByText(/Define the work your workspace repeats/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Find a work definition' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search work definitions' }), {
      target: { value: 'Event' },
    });
    expect(screen.getByText('No published definitions match these filters.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  });
});

it('keeps owner-visible workspace drafts without labeling them as team drafts', () => {
  render(
    <WorkTemplateLibrary
      orgId="org"
      items={[
        definition('Recovered draft', 'draft', 'personal'),
        {
          ...definition('Workspace draft', 'draft', 'organization'),
          id: WorkTemplateOut.shape.id.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW'),
        },
        {
          ...definition('Team draft', 'draft', 'team'),
          id: WorkTemplateOut.shape.id.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY'),
        },
      ]}
    />,
  );
  const own = within(screen.getByRole('region', { name: 'Your drafts' }));
  expect(own.getByRole('link', { name: /Recovered draft/ })).toBeVisible();
  expect(own.getByRole('link', { name: /Workspace draft/ })).toBeVisible();
  const team = within(screen.getByRole('region', { name: 'Team drafts' }));
  expect(team.getByRole('link', { name: /Team draft/ })).toBeVisible();
  expect(team.queryByRole('link', { name: /Workspace draft/ })).not.toBeInTheDocument();
});

it('uses readiness headings above ownership and avoids a five-level kind outline', () => {
  render(<WorkTemplateLibrary orgId="org" items={[definition('Event', 'draft', 'personal')]} />);
  expect(screen.getByRole('heading', { name: 'Continue defining', level: 2 })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Your drafts', level: 3 })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument();
});

it('keeps actual required drafts under their current parent and removes stale relationship guidance', () => {
  const event = definition('Event', 'draft', 'personal'),
    vendor = definition('Vendor booking', 'draft', 'personal', 'task');
  vendor.pendingPublication = {
    reservedFirstVersionId: WorkTemplateOut.shape.pendingPublication
      .unwrap()
      .shape.reservedFirstVersionId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY'),
  };
  event.definition.blueprint.steps = [
    BlueprintStep.parse({
      ...galleryFixture('event').definition.blueprint.steps[0],
      template: {
        workTypeId: vendor.id,
        selection: {
          kind: 'pinned',
          workTypeVersionId: vendor.pendingPublication.reservedFirstVersionId,
        },
      },
    }),
  ];
  const view = render(<WorkTemplateLibrary orgId="org" items={[vendor, event]} />);
  const own = within(screen.getByRole('region', { name: 'Your drafts' }));
  expect(
    own
      .getByRole('link', { name: /^Event/ })
      .compareDocumentPosition(own.getByRole('link', { name: /Vendor booking/ })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(own.getByText(/Needed by Event/)).toBeVisible();
  event.draftDefinition = { ...event.definition, blueprint: { steps: [], dependencies: [] } };
  view.rerender(<WorkTemplateLibrary orgId="org" items={[vendor, event]} />);
  expect(screen.queryByText(/Needed by Event/)).not.toBeInTheDocument();
});

it('resumes real unpublished edits under their draft name while keeping the publication ready', () => {
  const event = definition('Published dinner', 'published', 'organization');
  event.draftDefinition = { ...event.definition, name: 'Dinner with volunteers' };
  render(<WorkTemplateLibrary orgId="org" items={[event]} />);
  expect(
    within(screen.getByRole('region', { name: 'Your drafts' })).getByRole('link', {
      name: /Dinner with volunteers/,
    }),
  ).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Ready to use' })).getByRole('link', {
      name: /Published dinner/,
    }),
  ).toBeVisible();
  expect(screen.getByText(/Unpublished edits/)).toBeVisible();
});
it('does not duplicate an unchanged publication because object keys have different order', () => {
  const event = definition('Published dinner', 'published', 'organization');
  const { payload, ...rest } = event.definition;
  event.draftDefinition = { payload, ...rest };
  render(<WorkTemplateLibrary orgId="org" items={[event]} />);
  expect(screen.queryByRole('region', { name: 'Continue defining' })).not.toBeInTheDocument();
});
