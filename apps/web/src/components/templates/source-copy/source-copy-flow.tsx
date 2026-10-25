'use client';
import { useState, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import type { WorkTemplateSourceCopyPreviewRequest } from '@docket/work/template-copy';
import { useActiveOrg } from '@/components/active-org';
import { useAppRouter } from '@/lib/interactions/navigation';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
import { useTemplateCopyAcceptance } from '../gallery/use-gallery-acceptance';
import { readGalleryOriginal } from '../gallery/gallery-acceptance-attempt';
import { GalleryReview, galleryReviewRecovery } from '../gallery/gallery-review';
import { GalleryReviewOmissions } from '../gallery/gallery-review-omissions';
import { GalleryCopyResult } from '../gallery/gallery-copy-result';
import { workTemplateHref } from '../work-template-navigation';
import {
  templateSourceCopyStatusDef,
  useTemplateSourceCopyAccept,
} from '../work-template-source-copy-queries';
import { sourceCopyAttempt } from './source-copy-attempt';
import { useSourceCopyReview } from './use-source-copy-review';
import { SourceCopyOptions, useSourceCopyOptions } from './source-copy-options';
import {
  createSourceCopy,
  writeSourceCopy,
  type SourceCopyMemory,
  type SourceCopyOwner,
} from './source-copy-session';

type Acceptance = ReturnType<typeof useSourceAcceptance>;
function useSourceAcceptance(owner: SourceCopyOwner, memory: SourceCopyMemory, orgId: string) {
  const scope = { ...owner, orgId, attemptId: memory.id };
  const client = useQueryClient();
  const transport = useTemplateSourceCopyAccept(orgId);
  const acceptance = useTemplateCopyAcceptance(
    async (input) => WorkTemplateCopyReceipt.parse(await transport.mutateAsync(input)),
    {
      scope,
      lookupReceipt: async (requestId) => {
        try {
          return WorkTemplateCopyReceipt.parse(
            await client.fetchQuery(templateSourceCopyStatusDef(orgId, requestId)),
          );
        } catch (failure) {
          if (failure instanceof UserFacingError && failure.status === 404) return null;
          throw failure;
        }
      },
    },
    sourceCopyAttempt,
  );
  return { acceptance, scope };
}
function SourceCopyWaiting({
  acceptance,
}: {
  readonly acceptance: Acceptance['acceptance'];
}): JSX.Element {
  return (
    <section className="flex flex-col gap-3 px-3 sm:px-0">
      <h1 className="text-title-large">Check saved copy</h1>
      {acceptance.error ? (
        <InlineBanner tone="critical" title="Could not check this copy">
          {acceptance.error}
        </InlineBanner>
      ) : (
        <p role="status">Checking whether your templates were saved…</p>
      )}
      {!acceptance.pending ? (
        <Button
          wrapLabel
          className="self-start"
          onClick={() => {
            void acceptance.resume().catch(() => undefined);
          }}
        >
          Check again
        </Button>
      ) : null}
    </section>
  );
}
interface FlowProps {
  readonly owner: SourceCopyOwner;
  readonly memory: SourceCopyMemory;
  readonly orgId: string;
  readonly onChange: (value: SourceCopyMemory) => boolean;
}
function useSourceCopyController(props: FlowProps) {
  const { owner, memory, orgId, onChange } = props;
  const destination = memory.destinationOrgId ?? orgId;
  const { acceptance, scope } = useSourceAcceptance(owner, memory, destination);
  const options = useSourceCopyOptions(memory, acceptance.ready && !acceptance.receipt);
  const request: WorkTemplateSourceCopyPreviewRequest = {
    roots: [memory.source],
    mode: memory.mode,
    labels: [],
    offerings: [],
  };
  const enabled =
    acceptance.ready && !acceptance.receipt && memory.phase === 'review' && options.ready;
  const review = useSourceCopyReview(destination, request, enabled);
  const router = useAppRouter();
  const { orgs } = useActiveOrg();
  const name = orgs.find((org) => org.id === destination)?.name ?? 'Workspace';
  const sourceName = orgs.find((org) => org.id === memory.source.organizationId)?.name;
  const locked = acceptance.pending || Boolean(memory.submitted && readGalleryOriginal(scope));
  function beginReview(): void {
    if (options.ready && onChange({ ...memory, phase: 'review' }))
      router.replace(`${workTemplateHref(destination)}/copy/${memory.id}`);
  }
  function accept(): void {
    if (
      !review.checked ||
      acceptance.pending ||
      review.updating ||
      review.error ||
      !options.ready ||
      acceptance.needsReview
    )
      return;
    if (onChange({ ...memory, submitted: true }))
      void acceptance.accept(review.checked.request, review.checked.preview);
  }
  return {
    ...props,
    destination,
    acceptance,
    options,
    review,
    name,
    sourceName,
    locked,
    beginReview,
    accept,
  };
}
type Controller = ReturnType<typeof useSourceCopyController>;
/** The same canonical checked-copy review, actual receipt and bundle continuation as the catalog. */
export function SourceCopyFlow(props: FlowProps): JSX.Element {
  const state = useSourceCopyController(props);
  if (state.acceptance.receipt)
    return (
      <SourceCopyOutcome
        {...props}
        orgId={state.destination}
        workspaceName={state.name}
        receipt={state.acceptance.receipt}
      />
    );
  if (!state.acceptance.ready) return <SourceCopyWaiting acceptance={state.acceptance} />;
  if (mustChoose(state)) return <SourceCopyChoose state={state} />;
  if (!state.review.checked)
    return (
      <SourceCopyPreparing
        error={state.review.error}
        pending={state.review.updating}
        onRetry={state.review.refresh}
        onBack={() => {
          props.onChange({ ...props.memory, phase: 'choices' });
        }}
      />
    );
  return <SourceCopyChecked state={state} checked={state.review.checked} />;
}
function mustChoose(state: Controller): boolean {
  if (
    state.memory.phase === 'choices' ||
    state.options.template.isError ||
    state.options.policy.isError
  )
    return true;
  if (
    !state.options.template.isPending &&
    !state.options.history.isFetching &&
    !state.options.selected
  )
    return true;
  return (
    !state.options.permission.loading && !state.options.policy.isPending && !state.options.allowed
  );
}
function SourceCopyChoose({ state }: { readonly state: Controller }): JSX.Element {
  return (
    <SourceCopyOptions
      memory={state.memory}
      options={state.options}
      locked={state.locked}
      onChange={(value) => {
        state.onChange(value);
      }}
      onReview={state.beginReview}
      onCheck={() => {
        void state.acceptance.resume().catch(() => undefined);
      }}
    />
  );
}
function SourceCopyChecked({
  state,
  checked,
}: {
  readonly state: Controller;
  readonly checked: NonNullable<Controller['review']['checked']>;
}): JSX.Element {
  const { memory, acceptance, review, options } = state;
  return (
    <GalleryReview
      preview={checked.preview}
      workspaceName={state.name}
      selectedItems={[]}
      state={{
        pending: acceptance.pending,
        updating: review.updating,
        blocked: !options.ready || acceptance.needsReview,
        error: acceptance.error ?? review.error,
      }}
      alerts={
        <>
          <p className="text-body-medium text-on-surface-variant px-3 sm:px-0">
            {state.sourceName
              ? `${options.selectedChoice?.label ?? 'Saved source'} from ${state.sourceName}`
              : options.selectedChoice?.label}
          </p>
          <div className="px-3 sm:px-0">
            <GalleryReviewOmissions preview={checked.preview} />
          </div>
        </>
      }
      recoveryAction={galleryReviewRecovery(acceptance, review.refresh)}
      onBack={() => {
        state.onChange({ ...memory, phase: 'choices' });
      }}
      onMode={(mode) => {
        state.onChange({ ...memory, mode });
      }}
      onAccept={state.accept}
    />
  );
}
function SourceCopyPreparing({
  error,
  pending,
  onRetry,
  onBack,
}: {
  readonly error: string | null;
  readonly pending: boolean;
  readonly onRetry: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-3 px-3 sm:px-0">
      <h1 className="text-title-large">Review this copy</h1>
      {error ? (
        <>
          <InlineBanner tone="critical" title="Could not review this copy" />
          <Button wrapLabel className="self-start" onClick={onRetry}>
            Review again
          </Button>
        </>
      ) : pending ? (
        <p role="status">Checking the templates…</p>
      ) : (
        <p>Check the source and destination before reviewing this copy.</p>
      )}
      <Button wrapLabel className="self-start" variant="ghost" onClick={onBack}>
        Back to choices
      </Button>
    </section>
  );
}
function SourceCopyOutcome({
  owner,
  memory,
  orgId,
  workspaceName,
  receipt,
}: {
  readonly owner: SourceCopyOwner;
  readonly memory: SourceCopyMemory;
  readonly orgId: string;
  readonly workspaceName: string;
  readonly receipt: WorkTemplateCopyReceipt;
}): JSX.Element {
  const router = useAppRouter();
  const [error, setError] = useState<string | null>(null);
  const base = workTemplateHref(orgId);
  const bundle = `${base}/gallery/copies/${receipt.bundleId}`;
  return (
    <>
      {error ? (
        <InlineBanner tone="critical" title="Could not start another copy">
          {error}
        </InlineBanner>
      ) : null}
      <GalleryCopyResult
        receipt={receipt}
        workspaceName={workspaceName}
        newLabel="Start another copy"
        undoneDescription="This copy is still undone. Start another copy to keep these templates again."
        onOpen={(value) => {
          router.push(value.mode === 'published' ? base : bundle);
        }}
        onReviewCopy={() => {
          router.push(bundle);
        }}
        onNew={() => {
          try {
            const next = {
              ...createSourceCopy(owner, memory.source),
              destinationOrgId: memory.destinationOrgId,
            };
            writeSourceCopy(owner, next);
            router.push(`${base}/copy/${next.id}`);
          } catch (failure) {
            setError(
              userErrorMessage(
                failure,
                'Could not start another copy. Your saved copy is still here.',
              ),
            );
          }
        }}
      />
    </>
  );
}
