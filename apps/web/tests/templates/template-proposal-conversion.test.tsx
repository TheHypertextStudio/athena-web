import { assertDefined } from '@docket/test-utils';
import { render, screen } from '@testing-library/react';
import { ContextProvider } from '@docket/ui/components';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { TemplateProposalReviewPage } from '@/components/templates/template-proposal-review-page';
const id = (last: string) => `01ARZ3NDEKTSV4RRFFQ69G5FA${last}`;
const mocks = vi.hoisted(() => ({ published: true }));
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/components/active-org', () => ({ useOptionalActiveOrg: () => ({ orgs: [] }) }));
vi.mock('@/lib/interactions/navigation', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/templates/work-template-definition-review', () => ({
  WorkTemplateDefinitionReview: () => <p>Starting outline</p>,
}));
vi.mock('@/components/templates/template-proposal-queries', () => ({
  templateProposalDef: () => ({}),
  useTemplateProposalDecision: () => ({ isPending: false }),
}));
vi.mock('@/lib/query', () => ({
  useApiQuery: () => ({
    data: {
      activityId: id('V'),
      sessionId: id('W'),
      proposerName: 'Athena',
      state: 'kept',
      revision: 1,
      definition: { name: 'Community event', payload: { targetType: 'task' } },
      templateId: id('X'),
      templateRevision: 1,
      publicationState: mocks.published ? 'published' : 'draft',
      hasReceipt: true,
      visibility: 'personal',
      ...(mocks.published
        ? {
            labelConversion: {
              labelGroupId: id('Y'),
              labelId: id('Z'),
              workTypeId: id('X'),
              workTypeVersionId: id('W'),
            },
          }
        : {}),
    },
    refetch: vi.fn(),
  }),
}));
it('continues from the checked actual publication into a separate explicit label review', () => {
  render(
    <ContextProvider>
      <TemplateProposalReviewPage orgId={id('V')} proposalId={id('V')} />
    </ContextProvider>,
  );
  const link = screen.getByRole('link', { name: 'Apply to labelled work' });
  const url = new URL(assertDefined(link.getAttribute('href')), 'https://docket.test');
  expect(url.pathname).toBe(`/orgs/${id('V')}/work-templates/convert-labels`);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    templateId: id('X'),
    versionId: id('W'),
    labelGroupId: id('Y'),
    labelId: id('Z'),
  });
});
