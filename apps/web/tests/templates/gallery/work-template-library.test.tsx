import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { galleryFixture } from './gallery-fixture';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { WorkTemplateLibrary } from '@/components/templates/gallery/work-template-library';
vi.mock('@/components/docket-link', () => ({
  default: ({ navigation, ...props }: ComponentProps<'a'> & { navigation?: string }) => (
    <a {...props} data-navigation={navigation} />
  ),
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
describe('organization work definition library', () => {
  it('shows each definition once, with draft and publication state beside its identity', () => {
    const published = definition('Published dinner', 'published', 'organization');
    published.draftDefinition = { ...published.definition, name: 'Community dinner' };
    render(
      <WorkTemplateLibrary
        orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX"
        items={[
          published,
          definition('Event', 'draft', 'personal'),
          definition('Team handover', 'draft', 'team'),
        ]}
      />,
    );
    const library = within(screen.getByRole('group', { name: 'Work definitions' }));
    expect(library.getAllByRole('link')).toHaveLength(3);
    const dinner = library.getByRole('link', { name: 'Open Community dinner' });
    expect(within(dinner).getByText('Published v3 · Draft changes')).toBeVisible();
    expect(within(dinner).getByText('Published as Published dinner')).toBeVisible();
    expect(
      within(library.getByRole('link', { name: 'Open Event' })).getByText('Private draft'),
    ).toBeVisible();
    expect(
      within(library.getByRole('link', { name: 'Open Team handover' })).getByText('Team draft'),
    ).toBeVisible();
    expect(screen.queryByText('Your drafts')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Continue defining' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /View published version/ }),
    ).not.toBeInTheDocument();
  });

  it('opens definitions as isolated authoring activities and orders names consistently', () => {
    const event = definition('Event', 'draft', 'personal');
    event.definition.description = 'Host an event with a secured venue.';
    const community = definition('Community gathering', 'draft', 'personal');
    render(<WorkTemplateLibrary orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" items={[event, community]} />);
    const links = within(screen.getByRole('group', { name: 'Work definitions' })).getAllByRole(
      'link',
    );
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Open Community gathering',
      'Open Event',
    ]);
    expect(links[1]).toHaveAttribute(
      'href',
      `/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAX/work-templates/${event.id}`,
    );
    expect(links[1]).toHaveAttribute('data-navigation', 'activity');
    expect(links[1]).toHaveAttribute('id', `work-template-${event.id}`);
    expect(
      within(screen.getByRole('link', { name: 'Open Event' })).getByText(
        'Host an event with a secured venue.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: /Continue defining Event/ })).not.toBeInTheDocument();
  });

  it('keeps reusable dependencies as independent definitions instead of inventing a parent hierarchy', () => {
    const event = definition('Event', 'draft', 'personal');
    const other = definition('Community gathering', 'draft', 'personal');
    const vendor = definition('Vendor booking', 'draft', 'team', 'task');
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
    other.definition.blueprint.steps = event.definition.blueprint.steps;
    render(
      <WorkTemplateLibrary orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" items={[vendor, event, other]} />,
    );
    const library = within(screen.getByRole('group', { name: 'Work definitions' }));
    expect(library.getAllByRole('link', { name: 'Open Vendor booking' })).toHaveLength(1);
    expect(screen.queryByText(/Needed by Event/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Before publishing/)).not.toBeInTheDocument();
    expect(screen.queryByText('Includes')).not.toBeInTheDocument();
  });

  it('filters actual drafts and publications without duplicating an available version', () => {
    const unchanged = definition('Unchanged dinner', 'published', 'organization');
    const { payload, ...rest } = unchanged.definition;
    unchanged.draftDefinition = { payload, ...rest };
    const changed = definition('Changed dinner', 'published', 'organization');
    changed.draftDefinition = { ...changed.definition, description: 'Include volunteers.' };
    render(
      <WorkTemplateLibrary
        orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX"
        items={[unchanged, changed, definition('Private event', 'draft', 'personal')]}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Drafts' }));
    expect(screen.getByRole('link', { name: 'Open Changed dinner' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Private event' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open Unchanged dinner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Published' }));
    expect(screen.getAllByRole('link', { name: /Open .* dinner/ })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Open Private event' })).not.toBeInTheDocument();
  });

  it('makes search visible and offers a recoverable empty result with retained kind filtering', () => {
    render(
      <WorkTemplateLibrary
        orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX"
        items={[
          definition('Event', 'published', 'organization'),
          definition('Handover', 'published', 'organization', 'task'),
        ]}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search work definitions' }), {
      target: { value: 'Event' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filter by work kind' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Work kind' }), {
      target: { value: 'task' },
    });
    expect(screen.getByText('No work definitions match these filters.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('textbox', { name: 'Search work definitions' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Work kind' })).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Open Event' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Handover' })).toBeVisible();
  });

  it('keeps defaults and archives reachable after the main definition library', () => {
    render(
      <WorkTemplateLibrary
        orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX"
        items={[
          definition('Event', 'published', 'organization'),
          definition('Blank project', 'published', 'organization', 'project', true),
          definition('Former event', 'archived', 'organization'),
        ]}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Open Blank project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Former event' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Defaults (1)' }));
    expect(screen.getByRole('link', { name: 'Open Blank project' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    expect(screen.getByRole('link', { name: 'Open Former event' })).toBeVisible();
  });

  it('introduces first use for one-off and ongoing work without empty publication queues', () => {
    render(<WorkTemplateLibrary orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" items={[]} />);
    expect(
      screen.getByRole('heading', { name: 'What work does your organization do?' }),
    ).toBeVisible();
    expect(screen.getByText(/one-off project or an ongoing program/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Ready to use' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Search work definitions' }),
    ).not.toBeInTheDocument();
  });
});
