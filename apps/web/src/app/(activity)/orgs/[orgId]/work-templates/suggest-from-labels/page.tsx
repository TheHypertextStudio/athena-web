'use client';
import type { JSX } from 'react';
import { z } from 'zod';
import { useAppSearchParams, useTypedRoute } from '@/lib/app-location';
import { LabelSuggestionPage } from '@/components/templates/label-suggestions/page';

/** Open explicit labelled-example review or resume an actual saved private suggestion request. */
export default function SuggestFromLabelsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/work-templates/suggest-from-labels');
  const search = useAppSearchParams();
  const request = z.ulid().safeParse(search.get('requestId'));
  return <LabelSuggestionPage orgId={orgId} requestId={request.success ? request.data : ''} />;
}
