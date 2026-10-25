'use client';
import { useState, type JSX } from 'react';
import { TemplateProposalReview } from '@docket/work/work-template-contract';
import { Button, Skeleton } from '@docket/ui/primitives';
import { ImmersiveShell, InlineBanner } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import { useOptionalActiveOrg } from '@/components/active-org';
import { useApiQuery } from '@/lib/query';
import { useAppRouter } from '@/lib/interactions/navigation';
import { UserFacingError } from '@/lib/problem';
import { WorkTemplateDefinitionReview } from './work-template-definition-review';
import { templateProposalDef, useTemplateProposalDecision } from './template-proposal-queries';
import { workTemplateHref } from './work-template-navigation';

type Action = 'keep' | 'adjust' | 'dismiss' | 'undo';
function useReview(orgId: string, proposalId: string) {
  const query = useApiQuery(templateProposalDef(orgId, proposalId));
  const mutation = useTemplateProposalDecision(orgId, proposalId);
  const router = useAppRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const parsed = TemplateProposalReview.safeParse(query.data);
  const review = parsed.success ? parsed.data : null;
  const editor = (id: string): string =>
    `${workTemplateHref(orgId, id)}?returnContext=proposal&returnProposal=${encodeURIComponent(proposalId)}`;
  async function decide(action: Action): Promise<void> {
    if (!review) return;
    setFailure(null);
    try {
      const result = await mutation.mutateAsync({
        action,
        expectedRevision: review.revision,
        expectedTemplateRevision: review.templateRevision,
      });
      if (action === 'adjust' && result.templateId) router.push(editor(result.templateId));
      else await query.refetch();
    } catch (error) {
      setFailure(
        error instanceof UserFacingError && error.status === 409
          ? 'This template changed since you reviewed it. Review the latest version before deciding; your edits are preserved.'
          : 'This decision could not be saved. Try again.',
      );
      await query.refetch();
    }
  }
  return { query, pending: mutation.isPending, failure, review, decide, editor };
}

/** Review an exact suggestion in an isolated activity, with explicit private-draft decisions. */
export function TemplateProposalReviewPage({
  orgId,
  proposalId,
}: {
  readonly orgId: string;
  readonly proposalId: string;
}): JSX.Element {
  const state = useReview(orgId, proposalId);
  const workspace = useOptionalActiveOrg()?.orgs.find((org) => org.id === orgId);
  return (
    <ImmersiveShell
      header={
        <nav
          aria-label="Template review navigation"
          className="flex min-w-0 items-center justify-between gap-3"
        >
          <Button variant="ghost" size="sm" asChild>
            <Link href="/inbox">
              <ChevronLeft aria-hidden="true" className="size-4" />
              Inbox
            </Link>
          </Button>
          <span className="text-body-small text-on-surface-variant truncate">
            {workspace?.name}
          </span>
        </nav>
      }
      footer={
        state.review ? (
          <ReviewActions
            review={state.review}
            pending={state.pending}
            decide={state.decide}
            editor={state.editor}
          />
        ) : undefined
      }
    >
      <main className="mx-auto flex w-full max-w-[1120px] min-w-0 flex-col gap-6 px-3 pb-6 sm:px-0 sm:pb-8">
        <ReviewContent orgId={orgId} state={state} />
      </main>
    </ImmersiveShell>
  );
}
function reviewStatus(review: TemplateProposalReview): string {
  if (review.state === 'undone')
    return 'This proposal was undone. Later changes and existing work are preserved.';
  if (review.state === 'dismissed') return 'You dismissed this suggestion.';
  if (review.publicationState === 'published')
    return 'You published this template. Existing work is preserved.';
  if (review.state === 'kept')
    return 'Saved as your private draft. Publish from the editor when you are ready to share it.';
  return 'Keep a private draft, or adjust its outline first. Publishing is a separate choice.';
}
function ReviewContent({
  orgId,
  state,
}: {
  readonly orgId: string;
  readonly state: ReturnType<typeof useReview>;
}): JSX.Element {
  if (state.query.isPending)
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-body-medium text-on-surface-variant">Loading template review…</p>
        <Skeleton className="h-64" />
      </div>
    );
  const review = state.review;
  if (state.query.isError || !review)
    return (
      <InlineBanner tone="critical" title="This review is unavailable">
        You may no longer have access to this proposal.{' '}
        <Button
          variant="ghost"
          onClick={() => {
            void state.query.refetch();
          }}
        >
          Try again
        </Button>
      </InlineBanner>
    );
  return (
    <>
      <ReviewHeading review={review} />
      <SecondaryReviewActions
        orgId={orgId}
        review={review}
        pending={state.pending}
        decide={state.decide}
      />
      {state.failure ? (
        <InlineBanner tone="critical" title="Review needed">
          {state.failure}
        </InlineBanner>
      ) : null}
      <WorkTemplateDefinitionReview
        orgId={orgId}
        compactDocument
        form={{ definition: review.definition, kind: review.definition.payload.targetType }}
        templateId={review.templateId ?? undefined}
      />
    </>
  );
}
function ReviewHeading({ review }: { readonly review: TemplateProposalReview }): JSX.Element {
  const kind = useVocabulary(review.definition.payload.targetType);
  return (
    <header className="flex flex-col gap-2">
      <p className="text-label-large text-on-surface-variant">
        Suggested by {review.proposerName} · {kind}
      </p>
      <h1 className="text-headline-small sm:text-headline-medium break-words">
        {review.definition.name}
      </h1>
      <p className="text-body-large text-on-surface-variant">
        {review.definition.description ?? 'A reusable starting point for this work.'}
      </p>
      <p className="text-body-medium">{reviewStatus(review)}</p>
    </header>
  );
}

interface ReviewActionProps {
  readonly review: TemplateProposalReview;
  readonly pending: boolean;
  readonly decide: (action: Action) => Promise<void>;
}
function ReviewActions({
  review,
  pending,
  decide,
  editor,
}: ReviewActionProps & {
  readonly editor: (id: string) => string;
}): JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] items-center justify-end px-3 sm:px-0">
      {review.state === 'pending' ? (
        <Button
          disabled={pending}
          onClick={() => {
            void decide('keep');
          }}
        >
          {pending ? 'Saving…' : 'Keep draft'}
        </Button>
      ) : null}
      {review.state === 'kept' && review.templateId ? (
        <Button asChild>
          <Link href={editor(review.templateId)}>
            {review.publicationState === 'published' ? 'Open template' : 'Open draft'}
          </Link>
        </Button>
      ) : null}
      {review.state === 'dismissed' || review.state === 'undone' ? (
        <Button variant="secondary" asChild>
          <Link href="/inbox">Back to Inbox</Link>
        </Button>
      ) : null}
    </div>
  );
}
function SecondaryReviewActions({
  orgId,
  review,
  pending,
  decide,
}: ReviewActionProps & {
  readonly orgId: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {review.state === 'pending' ? (
        <>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              void decide('adjust');
            }}
          >
            Adjust
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              void decide('dismiss');
            }}
          >
            Dismiss
          </Button>
        </>
      ) : null}
      {review.labelConversion ? (
        <PublishedLabelContinuation orgId={orgId} source={review.labelConversion} />
      ) : null}
      {review.hasReceipt && review.state !== 'undone' ? (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            void decide('undo');
          }}
        >
          Undo
        </Button>
      ) : null}
    </div>
  );
}

function PublishedLabelContinuation({
  orgId,
  source,
}: {
  readonly orgId: string;
  readonly source: NonNullable<TemplateProposalReview['labelConversion']>;
}): JSX.Element {
  const query = new URLSearchParams({
    templateId: source.workTypeId,
    versionId: source.workTypeVersionId,
    labelGroupId: source.labelGroupId,
    labelId: source.labelId,
  });
  return (
    <Button variant="secondary" asChild>
      <Link href={`${workTemplateHref(orgId)}/convert-labels?${query}`}>
        Apply to labelled work
      </Link>
    </Button>
  );
}
