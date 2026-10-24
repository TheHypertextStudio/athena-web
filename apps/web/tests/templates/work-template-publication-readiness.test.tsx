import { mocks, template, nestedId, versionId } from './work-template-authoring-fixture';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { galleryFixture } from './gallery/gallery-fixture';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { WorkTemplateForm } from '@/components/templates/work-template-authoring';
const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
function withReference() {
  const parent = template();
  parent.definition.name = 'Event';
  parent.definition.blueprint.steps = [
    BlueprintStep.parse({
      ...galleryFixture('event').definition.blueprint.steps[0],
      key: 'venue',
      kind: 'task',
      fields: { title: 'Book venue' },
      template: {
        workTypeId: nestedId,
        selection: { kind: 'pinned', workTypeVersionId: versionId },
      },
    }),
  ];
  return parent;
}
it('shows the checked unpublished prerequisite beside the publication decision and prevents premature Publish', () => {
  const child = template('task');
  child.id = WorkTemplateOut.shape.id.parse(nestedId);
  child.definition.name = 'Vendor booking';
  child.pendingPublication = {
    reservedFirstVersionId: WorkTemplateOut.shape.pendingPublication
      .unwrap()
      .shape.reservedFirstVersionId.parse(versionId),
  };
  mocks.catalog = [child];
  render(<WorkTemplateForm orgId={orgId} initial={withReference()} onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
  const header = within(screen.getByRole('region', { name: 'Review and publish' }));
  expect(header.getByRole('button', { name: 'Publish to workspace' })).toBeDisabled();
  expect(screen.getByText('Publish Vendor booking before Event.')).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Before publishing' })).getByRole('link', {
      name: 'Review Vendor booking',
    }),
  ).toHaveAttribute(
    'href',
    `/orgs/${orgId}/work-templates/${nestedId}?section=review&returnTo=${withReference().id}`,
  );
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('keeps an actual historical publication valid rather than treating a nonlatest pin as unpublished', () => {
  const child = template('task');
  child.id = WorkTemplateOut.shape.id.parse(nestedId);
  child.definition.name = 'Vendor booking';
  child.status = 'published';
  child.latestVersion = {
    id: WorkTemplateOut.shape.latestVersion.unwrap().shape.id.parse('01ARZ3NDEKTSV4RRFFQ69G5FAT'),
    number: 3,
    workTypeId: child.id,
    organizationId: child.organizationId,
    definition: child.definition,
    publishedAt: child.createdAt,
    publishedByActorId: null,
  };
  mocks.catalog = [child];
  mocks.versions = [{ id: versionId, number: 2 }];
  render(<WorkTemplateForm orgId={orgId} initial={withReference()} onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
  const header = within(screen.getByRole('region', { name: 'Review and publish' }));
  expect(header.getByRole('button', { name: 'Publish to workspace' })).toBeEnabled();
  expect(header.queryByRole('link', { name: 'Review Vendor booking' })).not.toBeInTheDocument();
  expect(screen.getByText('Vendor booking · Keep Version 2')).toBeVisible();
});

it.each(['loading', 'error'] as const)(
  'does not invite publication or reveal unverified child names while linked definitions are %s',
  (state) => {
    mocks.catalogState = state;
    mocks.catalog = [];
    render(<WorkTemplateForm orgId={orgId} initial={withReference()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    const header = within(screen.getByRole('region', { name: 'Review and publish' }));
    expect(header.getByRole('button', { name: 'Publish to workspace' })).toBeDisabled();
    expect(header.queryByText(/Vendor booking/)).not.toBeInTheDocument();
    if (state === 'error') {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(mocks.refetch).toHaveBeenCalled();
    } else expect(screen.getByText('Checking included templates…')).toBeVisible();
  },
);
it('focuses the publication decision on entering Review with the full starting document and included work', () => {
  render(<WorkTemplateForm orgId={orgId} initial={withReference()} onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }), { detail: 1 });
  const review = within(screen.getByRole('region', { name: 'Work definition review' }));
  expect(screen.getByRole('heading', { name: 'Review & publish' })).toHaveFocus();
  expect(
    review
      .getByRole('heading', { name: 'Starting work' })
      .compareDocumentPosition(review.getByRole('heading', { name: 'Included work' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(review.getByRole('heading', { name: 'Preparation' })).toBeVisible();
});
