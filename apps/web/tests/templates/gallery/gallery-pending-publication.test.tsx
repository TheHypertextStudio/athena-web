import type { ComponentProps } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { WorkTemplateBlueprintReferenceFields } from '@/components/templates/work-template-blueprint-reference-fields';
import { WorkTemplateReviewNestedVersion } from '@/components/templates/work-template-review-child-details';
import { galleryFixture } from './gallery-fixture';
const reads = vi.hoisted(() => ({
  query: vi.fn(),
  versions: [] as { id: string; number: number }[],
}));
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/lib/query', () => ({
  useApiQuery: (definition: { enabled: boolean }) => {
    reads.query(definition);
    return {
      data: definition.enabled ? { items: reads.versions } : undefined,
      isPending: false,
      isError: false,
    };
  },
}));
vi.mock('@/components/templates/work-template-queries', () => ({
  workTemplateVersionsDef: () => ({}),
}));
afterEach(cleanup);
beforeEach(() => {
  reads.query.mockClear();
  reads.versions = [];
});
const pending = WorkTemplateOut.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  targetType: 'task',
  status: 'draft',
  scope: 'personal',
  ownerActorId: null,
  teamId: null,
  isBase: false,
  revision: 0,
  definition: { name: 'Vendor booking', payload: { targetType: 'task' } },
  offeredTeamIds: [],
  latestVersion: null,
  pendingPublication: { reservedFirstVersionId: '01ARZ3NDEKTSV4RRFFQ69G5FAY' },
  canEdit: true,
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
});
function step() {
  return BlueprintStep.parse({
    ...galleryFixture('event').definition.blueprint.steps[0],
    template: {
      workTypeId: pending.id,
      selection: {
        kind: 'pinned',
        workTypeVersionId: pending.pendingPublication?.reservedFirstVersionId,
      },
    },
  });
}
it('keeps the exact reserved pin and names its authorized unpublished draft without fake version choices', () => {
  const change = vi.fn();
  render(
    <WorkTemplateBlueprintReferenceFields
      orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX"
      step={step()}
      templates={[pending]}
      disabled={false}
      onChange={change}
    />,
  );
  expect(
    within(screen.getByRole('combobox', { name: 'Start from template' })).getByRole('option', {
      name: 'Unpublished Vendor booking',
    }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Template version' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Review Vendor booking' })).toHaveAttribute(
    'href',
    `/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAX/work-templates/${pending.id}?section=review`,
  );
  expect(reads.query.mock.calls[0]?.[0].enabled).toBe(false);
  expect(change).not.toHaveBeenCalled();
});
it('reviews actual pending draft identity without calling it a fixed publication', () => {
  const reference = step().template;
  if (!reference) throw new Error('Missing actual reference fixture.');
  render(
    <WorkTemplateReviewNestedVersion
      orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX"
      template={reference}
      selected={pending}
      name="Book venue"
    />,
  );
  expect(screen.getByText(/Unpublished Vendor booking — publish/)).toBeVisible();
  expect(screen.queryByText(/Fixed publication/)).not.toBeInTheDocument();
  expect(reads.query.mock.calls[0]?.[0].enabled).toBe(false);
});
it('does not match another reserved identity or offer unrelated private drafts for new selections', () => {
  const other = WorkTemplateOut.parse({ ...pending, id: '01ARZ3NDEKTSV4RRFFQ69G5FAW' });
  render(
    <WorkTemplateBlueprintReferenceFields
      orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX"
      step={step()}
      templates={[other]}
      disabled={false}
      onChange={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole('option', { name: 'Unpublished Vendor booking' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Review Vendor booking' })).not.toBeInTheDocument();
  expect(screen.getAllByText(/Version unavailable/).length).toBeGreaterThan(0);
});
it('shows a numbered publication only when the exact returned version exists', () => {
  const reference = step().template;
  if (!reference) throw new Error('Missing actual reference fixture.');
  reads.versions = [
    {
      id: reference.selection.kind === 'pinned' ? reference.selection.workTypeVersionId : '',
      number: 2,
    },
  ];
  render(
    <WorkTemplateReviewNestedVersion
      orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX"
      template={reference}
      name="Vendor booking"
    />,
  );
  expect(screen.getByText('Vendor booking · Keep Version 2')).toBeVisible();
});
