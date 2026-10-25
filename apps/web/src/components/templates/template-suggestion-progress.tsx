'use client';
import type { JSX } from 'react';
import { TemplateTailoringStatus } from '@docket/work/template-gallery-contract';
import { Button } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { useLiveApiQuery } from '@/lib/query';
import Link from '@/components/docket-link';
import { tailoringStatusDef, useTailoringRetry } from './gallery/template-tailoring-queries';
/** Resume a real saved suggestion with its existing runner status and actual proposal links. */
export function TemplateSuggestionProgress({
  orgId,
  id,
}: {
  readonly orgId: string;
  readonly id: string;
}): JSX.Element {
  const query = useLiveApiQuery(
      {
        ...tailoringStatusDef(orgId, id),
        refetchInterval: (query) => {
          const status = TemplateTailoringStatus.safeParse(query.state.data);
          return !status.success ||
            status.data.status === 'pending' ||
            status.data.status === 'running'
            ? 3000
            : false;
        },
      },
      3000,
    ),
    retry = useTailoringRetry(orgId);
  const parsed = TemplateTailoringStatus.safeParse(query.data);
  if (query.isError)
    return (
      <InlineBanner tone="critical" title="This request is unavailable">
        <Button
          variant="ghost"
          onClick={() => {
            void query.refetch();
          }}
        >
          Try again
        </Button>
      </InlineBanner>
    );
  if (!parsed.success)
    return (
      <p role="status" className="text-body-medium">
        Loading saved request…
      </p>
    );
  const current = parsed.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-medium">
        {requestProgressMessage(current.status, current.proposalIds.length)}
      </p>
      {current.proposalIds.map((proposalId) => (
        <Link
          key={proposalId}
          href={`/orgs/${orgId}/work-templates/review/${proposalId}`}
          className="text-primary text-body-medium underline"
        >
          Review proposed template
        </Link>
      ))}
      {current.status === 'failed' || current.status === 'pending' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={retry.isPending}
            onClick={() => {
              retry.mutate(id);
            }}
          >
            {retry.isPending ? 'Retrying…' : 'Retry request'}
          </Button>
        </div>
      ) : null}
      {retry.isError ? (
        <InlineBanner tone="critical" title="Request could not resume">
          The context or your access may have changed. Choose other context to review the current
          saved records.
        </InlineBanner>
      ) : null}
    </div>
  );
}

function requestProgressMessage(status: string, count: number): string {
  if (count) return 'Your proposed starting work is ready to review.';
  if (status === 'pending' || status === 'running')
    return 'Athena is preparing a proposal from your selected saved context.';
  if (status === 'failed')
    return 'Athena could not finish this request. Your selected context is saved.';
  return 'This request did not produce a template proposal. You can continue with the curated starting points.';
}
