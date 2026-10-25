import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkTemplateCopyBundle,
  WorkTemplateCopyUndoResult,
} from '@docket/work/template-gallery-contract';
import {
  GalleryCopyBundle,
  nextGalleryDraft,
} from '@/components/templates/gallery/gallery-copy-bundle';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { galleryFixture } from './gallery-fixture';
import { GalleryCopyResult } from '@/components/templates/gallery/gallery-copy-result';
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
afterEach(cleanup);
const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  eventId = '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  vendorId = '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  versionId = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
function bundle() {
  const template = (id: string, name: string, targetType: 'task' | 'project') => ({
    id,
    organizationId: orgId,
    targetType,
    status: 'draft',
    scope: 'personal',
    ownerActorId: null,
    teamId: null,
    isBase: false,
    revision: 0,
    definition: { name, payload: { targetType } },
    offeredTeamIds: [],
    latestVersion: null,
    canEdit: true,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
  });
  const event = template(eventId, 'Edited community dinner', 'project');
  return WorkTemplateCopyBundle.parse({
    receipt: {
      bundleId: eventId,
      changeSetId: vendorId,
      mode: 'private_drafts',
      state: 'installed',
      roots: [{ workTypeId: eventId, workTypeVersionId: null, targetType: 'project' }],
    },
    entries: [
      {
        key: 'event',
        isRoot: true,
        workTypeId: eventId,
        template: {
          ...event,
          definition: {
            ...event.definition,
            blueprint: { steps: [dependencyStep(vendorId)], dependencies: [] },
          },
        },
        catalogOrigin: null,
        dependencies: [vendorId],
        reservation: { state: 'pending', reservedFirstPublicationId: versionId },
      },
      {
        key: 'vendor',
        isRoot: false,
        workTypeId: vendorId,
        template: template(vendorId, 'Vendor booking', 'task'),
        catalogOrigin: null,
        dependencies: [],
        reservation: { state: 'pending', reservedFirstPublicationId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ' },
      },
    ],
  });
}
describe('durable private copy review', () => {
  it('reads current edited drafts and begins with the actual unpublished dependency', () => {
    const saved = bundle();
    render(<GalleryCopyBundle bundle={saved} orgId={orgId} onNew={vi.fn()} />);
    expect(nextGalleryDraft(saved)?.workTypeId).toBe(vendorId);
    expect(screen.getByRole('link', { name: 'Edited community dinner' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review Vendor booking' })).toHaveAttribute(
      'href',
      `/orgs/${orgId}/work-templates/${vendorId}?section=review`,
    );
    expect(screen.getByText('Publish Vendor booking before this template.')).toBeVisible();
    expect(screen.queryByText(/Fixed publication|Version 1/)).not.toBeInTheDocument();
    expect(saved.receipt.roots[0]?.workTypeVersionId).toBeNull();
  });
  it('does not treat an inaccessible consumed dependency as ready to publish', () => {
    const saved = bundle();
    const dependency = saved.entries[1];
    if (!dependency) throw new Error('Missing saved dependency fixture.');
    dependency.reservation.state = 'consumed';
    dependency.template = null;
    expect(nextGalleryDraft(saved)).toBeUndefined();
  });
  it('renders an undone original without a Saved or Open success action', () => {
    const receipt = { ...bundle().receipt, state: 'undone' as const };
    render(
      <GalleryCopyResult
        receipt={receipt}
        workspaceName="Studio"
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'This copy was undone' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open drafts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Private drafts kept' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose starting points' })).toBeVisible();
  });
});

it('waits for real Undo and explains actual retained definitions without simulating a reversal', () => {
  const saved = bundle(),
    onUndo = vi.fn();
  const undo = { pending: false, error: null, outcome: null, onUndo };
  const view = render(
    <GalleryCopyBundle bundle={saved} orgId={orgId} onNew={vi.fn()} undo={undo} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Undo this copy' }));
  expect(onUndo).toHaveBeenCalledOnce();
  expect(screen.queryByRole('heading', { name: 'This copy was undone' })).not.toBeInTheDocument();
  const outcome = WorkTemplateCopyUndoResult.parse({
    receipt: { ...saved.receipt, state: 'undone' },
    retained: [{ workTypeId: vendorId, reason: 'changed_since' }],
  });
  view.rerender(
    <GalleryCopyBundle
      bundle={{ ...saved, receipt: outcome.receipt }}
      orgId={orgId}
      onNew={vi.fn()}
      undo={{ ...undo, outcome }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'This copy was undone' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Templates kept' })).toBeVisible();
  expect(screen.getByText(/changed after it was copied/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Undo this copy' })).not.toBeInTheDocument();
});

function dependencyStep(id: string) {
  return BlueprintStep.parse({
    ...galleryFixture('event').definition.blueprint.steps[0],
    template: {
      workTypeId: id,
      selection: { kind: 'pinned', workTypeVersionId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ' },
    },
  });
}
it('uses edited dependency removals rather than installation provenance on reentry', () => {
  const saved = bundle(),
    root = saved.entries[0];
  if (!root?.template) throw new Error('Missing root fixture.');
  root.template.draftDefinition = {
    ...root.template.definition,
    blueprint: { steps: [], dependencies: [] },
  };
  render(<GalleryCopyBundle bundle={saved} orgId={orgId} onNew={vi.fn()} />);
  expect(nextGalleryDraft(saved)?.workTypeId).toBe(eventId);
  expect(
    screen.queryByText('Publish Vendor booking before this template.'),
  ).not.toBeInTheDocument();
});
it('requires editor review for a current external reference without guessing its publication', () => {
  const saved = bundle(),
    root = saved.entries[0];
  if (!root?.template) throw new Error('Missing root fixture.');
  root.template.draftDefinition = {
    ...root.template.definition,
    blueprint: { steps: [dependencyStep('01ARZ3NDEKTSV4RRFFQ69G5FAX')], dependencies: [] },
  };
  saved.entries = [root];
  render(<GalleryCopyBundle bundle={saved} orgId={orgId} onNew={vi.fn()} />);
  expect(nextGalleryDraft(saved)).toBeUndefined();
  expect(screen.getByText('Review the included templates before sharing this one.')).toBeVisible();
  expect(
    screen.queryByText('Publish Vendor booking before this template.'),
  ).not.toBeInTheDocument();
});
it('labels an archived retained publication as archived after Undo', () => {
  const saved = bundle(),
    root = saved.entries[0];
  if (!root?.template) throw new Error('Missing root fixture.');
  saved.receipt.state = 'undone';
  root.template.status = 'archived';
  root.reservation.state = 'consumed';
  root.template.latestVersion = {
    id: versionId as NonNullable<typeof root.template.latestVersion>['id'],
    workTypeId: root.workTypeId,
    organizationId: root.template.organizationId,
    number: 1,
    definition: root.template.definition,
    publishedAt: root.template.createdAt,
    publishedByActorId: null,
  };
  render(<GalleryCopyBundle bundle={saved} orgId={orgId} onNew={vi.fn()} />);
  expect(screen.getByText('Project · Archived')).toBeVisible();
  expect(screen.queryByText('Project · Published · Version 1')).not.toBeInTheDocument();
});

it('explains the next real prerequisite before its parent without repeating page hierarchy', () => {
  render(<GalleryCopyBundle bundle={bundle()} orgId={orgId} onNew={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Continue setup', level: 2 })).toBeVisible();
  expect(
    screen.getByText('Edited community dinner uses this template. Review and share it first.'),
  ).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Selected templates', level: 2 })).toBeVisible();
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
});
