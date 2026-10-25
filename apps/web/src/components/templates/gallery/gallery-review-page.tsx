'use client';
import type { JSX } from 'react';
import { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { useActiveOrg } from '@/components/active-org';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { workTemplateHref } from '../work-template-navigation';
import { WorkTemplateWorkspaceFrame } from '../work-template-workspace-frame';
import { useAppRouter } from '@/lib/interactions/navigation';
import { UserFacingError } from '@/lib/problem';
import {
  templateGalleryCopyStatusDef,
  useTemplateGalleryAccept,
} from '../work-template-gallery-queries';
import { QueryLoadFailure } from '@/components/feedback';
import { useGalleryCatalog, type GalleryCatalogState } from './use-gallery-catalog';
import { gallerySelectedOutcomes, galleryReviewedMetadata } from './gallery-review-context';
import { GalleryReview } from './gallery-review';
import { GalleryCopyResult } from './gallery-copy-result';
import { useGalleryAcceptance, type GalleryAcceptance } from './use-gallery-acceptance';
import { useGalleryReview, type GalleryReviewQuery } from './use-gallery-review';
import { gallerySelectedItems, useGalleryWorkspace } from './gallery-workspace';

function useActualAcceptance() {
  const state = useGalleryWorkspace(),
    client = useQueryClient();
  const transport = useTemplateGalleryAccept(state.scope.orgId);
  return useGalleryAcceptance(
    async (input) => WorkTemplateCopyReceipt.parse(await transport.mutateAsync(input)),
    {
      scope: state.scope,
      lookupReceipt: async (requestId) => {
        try {
          return WorkTemplateCopyReceipt.parse(
            await client.fetchQuery(templateGalleryCopyStatusDef(state.scope.orgId, requestId)),
          );
        } catch (failure) {
          if (failure instanceof UserFacingError && failure.status === 404) return null;
          throw failure;
        }
      },
    },
  );
}
function ReviewWaiting({
  empty,
  error,
  refresh,
  back,
}: {
  readonly empty: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly back: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-title-large sm:text-headline-medium px-3 sm:px-0">
        Review selected templates
      </h1>
      {empty ? (
        <>
          <p className="px-3 sm:px-0">Choose templates to add before reviewing your selection.</p>
          <Button className="mx-3 self-start sm:mx-0" onClick={back}>
            Choose starting points
          </Button>
        </>
      ) : error ? (
        <>
          <InlineBanner tone="critical" title="Could not prepare this selection">
            {error}
          </InlineBanner>
          <Button className="mx-3 sm:mx-0" onClick={refresh}>
            Review again
          </Button>
          <Button variant="ghost" onClick={back}>
            Back to selection
          </Button>
        </>
      ) : (
        <Skeleton className="h-64" />
      )}
    </div>
  );
}
function ActualCopyResult({
  acceptance,
  workspaceName,
  base,
  back,
}: {
  readonly acceptance: GalleryAcceptance;
  readonly workspaceName: string;
  readonly base: string;
  readonly back: () => void;
}): JSX.Element | null {
  const router = useAppRouter();
  return acceptance.receipt ? (
    <GalleryCopyResult
      receipt={acceptance.receipt}
      workspaceName={workspaceName}
      onOpen={(receipt) => {
        router.push(`${base}/copies/${receipt.bundleId}`);
      }}
      onNew={() => {
        acceptance.reset();
        back();
      }}
    />
  ) : null;
}
function ReviewAlerts({
  acceptance,
  review,
  error,
  retry,
}: {
  readonly acceptance: GalleryAcceptance;
  readonly review: GalleryReviewQuery;
  readonly error: string | null;
  readonly retry: () => void;
}): JSX.Element {
  return (
    <>
      {acceptance.checkingOutcome ? (
        <p role="status" className="text-body-medium px-3 sm:px-0">
          Checking whether your templates were saved…
        </p>
      ) : null}
      {acceptance.needsReview ? (
        <Button
          className="mx-3 self-start sm:mx-0"
          onClick={() => {
            acceptance.reset();
            review.refresh();
          }}
        >
          Check updated review
        </Button>
      ) : null}
      {error ? (
        <InlineBanner tone="critical" title="Could not load destination choices">
          {error}
          <Button variant="ghost" onClick={retry}>
            Retry choices
          </Button>
        </InlineBanner>
      ) : null}
    </>
  );
}
function OriginalWaiting({ acceptance }: { readonly acceptance: GalleryAcceptance }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h1 className="text-title-large sm:text-headline-medium px-3 sm:px-0">Check saved work</h1>
      {acceptance.pending ? (
        <p role="status" className="px-3 sm:px-0">
          Checking whether your templates were saved…
        </p>
      ) : null}
      {acceptance.error ? (
        <InlineBanner tone="critical" title="Could not check the original copy">
          {acceptance.error}
        </InlineBanner>
      ) : null}
      {!acceptance.pending ? (
        <Button
          className="mx-3 self-start sm:mx-0"
          onClick={() => {
            void acceptance.resume().catch(() => undefined);
          }}
        >
          Check again
        </Button>
      ) : null}
    </div>
  );
}
function canPreview(enabled: boolean, catalog: GalleryCatalogState): boolean {
  return enabled && !catalog.pending && !catalog.failed;
}
function useReviewDestination(orgId: string): {
  readonly base: string;
  readonly workspaceName: string;
  readonly back: () => void;
} {
  const router = useAppRouter(),
    { orgName } = useActiveOrg();
  const base = workTemplateHref(orgId, '/gallery');
  return {
    base,
    workspaceName: orgName(orgId),
    back: () => {
      router.push(base);
    },
  };
}
/** Review actual checked rewrites and visibility, then accept through the canonical copy service. */
export function GalleryReviewPage(): JSX.Element {
  const state = useGalleryWorkspace();
  return (
    <WorkTemplateWorkspaceFrame orgId={state.scope.orgId} parent={{ label: 'Work templates' }}>
      <GalleryReviewContent />
    </WorkTemplateWorkspaceFrame>
  );
}
function GalleryReviewContent(): JSX.Element {
  const state = useGalleryWorkspace();
  const { base, back, workspaceName } = useReviewDestination(state.scope.orgId);
  const acceptance = useActualAcceptance();
  const enabled = acceptance.ready && !acceptance.receipt;
  const catalog = useGalleryCatalog(state.scope.orgId, enabled);
  const review = useGalleryReview(
    state.scope.orgId,
    state.memory.choices,
    canPreview(enabled, catalog),
  );
  const pickers = useComposerOptions(state.scope.orgId, ['labels', 'teams'], enabled);
  const policy = useCanManageOrg(state.scope.orgId, { enabled });
  if (acceptance.receipt)
    return (
      <ActualCopyResult
        acceptance={acceptance}
        workspaceName={workspaceName}
        base={base}
        back={back}
      />
    );
  if (!acceptance.ready) return <OriginalWaiting acceptance={acceptance} />;
  if (catalog.failed) return <QueryLoadFailure title="Work gallery" query={catalog.failure} />;
  if (!state.memory.choices.roots.length || !review.checked)
    return (
      <ReviewWaiting
        empty={!state.memory.choices.roots.length}
        error={review.error}
        refresh={review.refresh}
        back={back}
      />
    );
  const checked = review.checked;
  const busy = acceptance.pending || review.updating;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <GalleryReview
        alerts={
          <ReviewAlerts
            acceptance={acceptance}
            review={review}
            error={pickers.error}
            retry={pickers.retry}
          />
        }
        preview={checked.preview}
        outcomes={gallerySelectedOutcomes(state.memory)}
        workspaceName={workspaceName}
        selectedItems={gallerySelectedItems(state, catalog.items)}
        state={{
          pending: acceptance.pending,
          updating: review.updating,
          blocked: Boolean(review.error) || acceptance.needsReview,
          error: acceptance.error ?? review.error,
        }}
        onBack={back}
        onMode={(mode) => {
          state.change({ ...state.memory, choices: { ...state.memory.choices, mode } });
        }}
        onAccept={() => {
          if (!busy && !review.error && !acceptance.needsReview)
            void acceptance.accept(checked.request, checked.preview);
        }}
        choices={{
          request: checked.request,
          preview: checked.preview,
          selectedItems: galleryReviewedMetadata(checked.preview, catalog.items),
          labelOptions: pickers.labelOptions,
          teamOptions: pickers.teamOptions,
          canManageOfferings: policy.canManage,
          disabled: busy || pickers.loading,
          onChange: (choices) => {
            state.change({ ...state.memory, choices });
          },
        }}
      />
    </div>
  );
}
