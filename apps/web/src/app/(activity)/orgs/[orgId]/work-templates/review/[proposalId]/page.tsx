'use client';
import type { JSX } from 'react';
import { TemplateProposalReviewPage } from '@/components/templates/template-proposal-review-page';
import { useTypedRoute } from '@/lib/app-location';

/** Open one exact recipient-private Athena proposal from Inbox. */
export default function TemplateReviewPage(): JSX.Element {
  const {
    params: { orgId, proposalId },
  } = useTypedRoute('/orgs/[orgId]/work-templates/review/[proposalId]');
  return <TemplateProposalReviewPage orgId={orgId} proposalId={proposalId} />;
}
