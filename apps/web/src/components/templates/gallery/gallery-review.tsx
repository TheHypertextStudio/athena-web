'use client';
import type { TemplateCopyReview } from './gallery-review-types';
import { useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';
import type { WorkTemplateGalleryItem } from '@docket/work/template-gallery-contract';
import { Button, Field, Select, Surface } from '@docket/ui/primitives';
import { InlineBanner, type InlineBannerAction } from '@docket/ui/components';
import type { GalleryAcceptance } from './use-gallery-acceptance';
import { GalleryCopyChoices, type GalleryCopyChoicesProps } from './gallery-copy-choices';
import { GalleryWorkOutline } from './gallery-work-outline';
import { galleryPreviewSources } from './gallery-structure';
import { GalleryReviewOmissions as Omissions } from './gallery-review-omissions';
import type { GalleryReviewOutcome } from './gallery-review-groups';
import { gallerySourceKey } from './gallery-metadata';
import {
  GalleryReviewOrganization,
  GalleryRequiredCopies,
  type GalleryReviewedCopy,
} from './gallery-review-organization';

/** Actual acceptance/review status is supplied by the canonical copy mutation owner. */
export interface GalleryReviewState {
  readonly pending: boolean;
  readonly updating: boolean;
  readonly blocked?: boolean;
  readonly error: string | null;
}
/** Read-only checked review with an explicit real acceptance callback; no simulated success state. */
export interface GalleryReviewProps {
  readonly preview: TemplateCopyReview;
  readonly outcomes?: readonly GalleryReviewOutcome[] | undefined;
  readonly workspaceName: string;
  readonly selectedItems: readonly WorkTemplateGalleryItem[];
  readonly state: GalleryReviewState;
  readonly choices?: GalleryCopyChoicesProps;
  readonly alerts?: ReactNode;
  readonly recoveryAction?: InlineBannerAction | undefined;
  readonly onMode: (mode: TemplateCopyReview['mode']) => void;
  readonly onAccept: (preview: TemplateCopyReview) => void;
  readonly onBack: () => void;
}
/**
 * Keep stale-review recovery with its failure while preserving the canonical attempt reset.
 * @param acceptance - The existing copy outcome owner.
 * @param refresh - Check current source revisions after clearing the stale attempt.
 * @param label - The ordinary gallery or saved-copy action label.
 * @returns One explicit recovery action only when the accepted review changed.
 */
export function galleryReviewRecovery(
  acceptance: Pick<GalleryAcceptance, 'needsReview' | 'reset'>,
  refresh: () => void,
  label = 'Review updated copy',
): InlineBannerAction | undefined {
  return acceptance.needsReview
    ? {
        label,
        onSelect: () => {
          acceptance.reset();
          refresh();
        },
      }
    : undefined;
}
function GalleryReviewError({
  props,
  onRecover,
}: {
  readonly props: GalleryReviewProps;
  readonly onRecover: () => void;
}): JSX.Element {
  const recovery = useRef<HTMLDivElement>(null);
  const action = props.recoveryAction;
  useEffect(() => {
    recovery.current?.focus({ preventScroll: true });
    recovery.current?.scrollIntoView({ block: 'center' });
  }, [props.state.error]);
  return (
    <div
      ref={recovery}
      role="region"
      aria-label="Copy could not be saved"
      tabIndex={-1}
      className="flex flex-col gap-3 outline-none"
    >
      <InlineBanner
        tone="critical"
        title={
          props.preview.mode === 'published'
            ? 'Could not add these templates'
            : 'Could not keep these drafts'
        }
      >
        {props.state.error}
      </InlineBanner>
      {action ? (
        <div className="px-3 sm:px-0">
          <Button
            wrapLabel
            className="self-start"
            aria-label={action.ariaLabel}
            onClick={() => {
              action.onSelect();
              onRecover();
            }}
          >
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
function GalleryDestination({ props }: { readonly props: GalleryReviewProps }): JSX.Element {
  const busy = props.state.pending || props.state.updating || props.state.blocked;
  const published = props.preview.mode === 'published';
  return (
    <Surface as="section" shape="medium" pad="comfortable" aria-label="Destination and visibility">
      <h2 className="text-title-large">Sharing</h2>
      <p className="text-title-medium break-words">{props.workspaceName}</p>
      <Field label="Who can see these templates">
        <Select
          disabled={busy}
          value={props.preview.mode}
          onChange={(event) => {
            props.onMode(event.target.value === 'published' ? 'published' : 'private_drafts');
          }}
        >
          <option value="private_drafts">Keep private drafts</option>
          <option value="published">Publish to workspace</option>
        </Select>
      </Field>
      <p className="text-body-medium text-on-surface-variant">
        {published
          ? `Members of ${props.workspaceName} can see and use the published templates.`
          : 'Only you can see these drafts. You can share them with the workspace later.'}
      </p>
      <p className="text-body-small text-on-surface-variant">
        These are starting points for future work. Saving them does not create work or start
        routines.
      </p>
    </Surface>
  );
}
function GalleryFocusedAdjustments({
  copy,
  preview,
  choices,
}: {
  readonly copy: GalleryReviewedCopy;
  readonly preview: TemplateCopyReview;
  readonly choices?: GalleryCopyChoicesProps | undefined;
}): JSX.Element | null {
  const key = gallerySourceKey(copy.source);
  const items =
    choices?.selectedItems.filter((item) => gallerySourceKey(item.identity) === key) ?? [];
  const omissions = preview.omissions.filter(
    (omission) => gallerySourceKey(omission.source) === key,
  );
  const mapped = items.some(
    (item) =>
      Boolean(choices?.request.labels.some((entry) => entry.sourceSlug === item.slug)) ||
      Boolean(choices?.request.offerings.some((entry) => entry.sourceSlug === item.slug)),
  );
  if (!omissions.length && !mapped) return null;
  return (
    <Surface
      as="section"
      shape="medium"
      tone="well"
      pad="comfortable"
      aria-label={`Changes in ${copy.name}`}
    >
      {omissions.length ? null : <h2 className="text-title-large">Changes in this copy</h2>}
      <Omissions
        headingLevel={2}
        preview={{
          ...preview,
          omissions: omissions,
        }}
      />
      {choices ? <GalleryCopyChoices {...choices} selectedItems={items} /> : null}
    </Surface>
  );
}
function GalleryFocusedReview({
  copy,
  preview,
  onBack,
  choices,
  useText,
}: {
  readonly useText?: string | undefined;
  readonly choices?: GalleryCopyChoicesProps | undefined;
  readonly copy: GalleryReviewedCopy;
  readonly preview: TemplateCopyReview;
  readonly onBack: () => void;
}): JSX.Element {
  return (
    <section aria-label={`Review ${copy.name}`} className="flex min-w-0 flex-col gap-3">
      <Button
        wrapLabel
        variant="ghost"
        className="self-start px-3 sm:px-0"
        autoFocus
        onClick={onBack}
      >
        Back to review
      </Button>
      <h1 className="text-title-large sm:text-headline-medium px-3 break-words sm:px-0">
        {copy.name}
      </h1>
      {useText ? <p className="text-body-medium px-3 sm:px-0">{useText}</p> : null}
      <GalleryWorkOutline
        definition={copy.definition}
        sources={galleryPreviewSources(preview)}
        identity={copy.source}
      />
      <GalleryFocusedAdjustments copy={copy} preview={preview} choices={choices} />
    </section>
  );
}
function ReviewHeader({
  workspaceName,
  headingRef,
}: {
  readonly workspaceName: string;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}): JSX.Element {
  return (
    <header className="flex min-w-0 flex-col gap-1 px-3 sm:px-0">
      <p className="text-label-large">Review for {workspaceName}</p>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-title-large sm:text-headline-medium outline-none"
      >
        Review selected templates
      </h1>
    </header>
  );
}
/** Review exact roots, required copies, actual rewritten structure and explicit publication visibility. */
export function GalleryReview(props: GalleryReviewProps): JSX.Element {
  const [inspecting, setInspecting] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  function revealReview(): void {
    reviewHeading.current?.focus({ preventScroll: true });
    reviewHeading.current?.scrollIntoView({ block: 'start' });
  }
  const focused = props.preview.copies.find((copy) => gallerySourceKey(copy.source) === inspecting);
  function inspect(copy: GalleryReviewedCopy): void {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInspecting(gallerySourceKey(copy.source));
  }
  function closeInspection(): void {
    setInspecting(null);
    requestAnimationFrame(() => {
      returnFocus.current?.focus();
    });
  }
  const busy = props.state.pending || props.state.updating;
  return (
    <>
      {focused ? (
        <GalleryFocusedReview
          copy={focused}
          useText={
            props.selectedItems.find(
              (item) => gallerySourceKey(item.identity) === gallerySourceKey(focused.source),
            )?.use
          }
          preview={props.preview}
          choices={props.choices}
          onBack={closeInspection}
        />
      ) : null}
      <div hidden={Boolean(focused)}>
        <div className="flex min-w-0 flex-col gap-3 sm:gap-5" aria-busy={busy}>
          <ReviewHeader workspaceName={props.workspaceName} headingRef={reviewHeading} />
          {props.alerts}
          <GalleryReviewOrganization
            preview={props.preview}
            selectedItems={props.selectedItems}
            outcomes={props.outcomes}
            onInspect={inspect}
          />
          <GalleryRequiredCopies preview={props.preview} onInspect={inspect} />
          <GalleryDestination props={props} />
          {props.state.error ? <GalleryReviewError props={props} onRecover={revealReview} /> : null}
          {props.state.updating ? (
            <p role="status" className="px-3 sm:px-0">
              Updating the review…
            </p>
          ) : null}
          <GalleryReviewFooter props={props} />
        </div>
      </div>
    </>
  );
}

function GalleryReviewFooter({ props }: { readonly props: GalleryReviewProps }): JSX.Element {
  const published = props.preview.mode === 'published';
  const busy = props.state.pending || props.state.updating || props.state.blocked;
  return (
    <div className="flex flex-col-reverse justify-between gap-2 px-3 sm:flex-row sm:gap-3 sm:px-0">
      <Button wrapLabel variant="ghost" disabled={props.state.pending} onClick={props.onBack}>
        Back to selection
      </Button>
      <Button
        wrapLabel
        disabled={busy}
        onClick={() => {
          props.onAccept(props.preview);
        }}
      >
        {props.state.pending
          ? published
            ? 'Adding…'
            : 'Keeping…'
          : published
            ? 'Publish to workspace'
            : 'Keep private drafts'}
      </Button>
    </div>
  );
}
