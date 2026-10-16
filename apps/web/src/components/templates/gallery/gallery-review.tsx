'use client';
import { useRef, useState, type JSX } from 'react';
import type {
  WorkTemplateGalleryPreview,
  WorkTemplateGalleryPreviewRequest,
  WorkTemplateGalleryItem,
} from '@docket/work/template-gallery-contract';
import { Button, Field, Select, Surface } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { GalleryCopyChoices, type GalleryCopyChoicesProps } from './gallery-copy-choices';
import { GalleryWorkOutline } from './gallery-work-outline';
import { galleryPreviewSources } from './gallery-structure';
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
  readonly preview: WorkTemplateGalleryPreview;
  readonly outcomes?: readonly GalleryReviewOutcome[] | undefined;
  readonly workspaceName: string;
  readonly selectedItems: readonly WorkTemplateGalleryItem[];
  readonly state: GalleryReviewState;
  readonly choices?: GalleryCopyChoicesProps;
  readonly onMode: (mode: WorkTemplateGalleryPreviewRequest['mode']) => void;
  readonly onAccept: (preview: WorkTemplateGalleryPreview) => void;
  readonly onBack: () => void;
}
function Omissions({
  preview,
}: {
  readonly preview: WorkTemplateGalleryPreview;
}): JSX.Element | null {
  if (!preview.omissions.length) return null;
  const labels = {
    label: 'Label references will be left out',
    image: 'Images will be left out',
    offering: 'Team offerings will be left out',
    label_suggestion: 'Suggested label is not mapped',
    offering_suggestion: 'Suggested team offering is not confirmed',
  };
  return (
    <section aria-label="Copy adjustments">
      <h3 className="text-title-medium">What changes in this copy</h3>
      <ul className="flex flex-col gap-3">
        {preview.omissions.map((omission, index) => {
          const copy = preview.copies.find(
            (entry) => gallerySourceKey(entry.source) === gallerySourceKey(omission.source),
          );
          return (
            <li key={`${gallerySourceKey(omission.source)}:${index}`}>
              <p className="text-body-medium">
                {copy?.name}: {labels[omission.kind]}
                {omission.value ? ` — ${omission.value}` : ''} ({omission.count})
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
function GalleryDestination({ props }: { readonly props: GalleryReviewProps }): JSX.Element {
  const busy = props.state.pending || props.state.updating || props.state.blocked;
  const published = props.preview.mode === 'published';
  return (
    <Surface as="section" shape="large" pad="roomy" aria-label="Destination and visibility">
      <h2 className="text-title-large">Destination and visibility</h2>
      <p className="text-title-medium break-words">{props.workspaceName}</p>
      <Field label="Copy visibility">
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
          : 'Only you can review these drafts. Publication is a separate, explicit action.'}
      </p>
      <p className="text-body-small text-on-surface-variant">
        Reusable definitions only. No work is created or schedules started yet.
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
  readonly preview: WorkTemplateGalleryPreview;
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
      pad="roomy"
      aria-label={`Optional adjustments for ${copy.name}`}
    >
      <h2 className="text-title-large">Optional adjustments</h2>
      <Omissions
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
  readonly preview: WorkTemplateGalleryPreview;
  readonly onBack: () => void;
}): JSX.Element {
  return (
    <section aria-label={`Review ${copy.name}`} className="flex min-w-0 flex-col gap-4">
      <Button variant="ghost" className="self-start" autoFocus onClick={onBack}>
        Back to review
      </Button>
      <h1 className="text-headline-medium break-words">{copy.name}</h1>
      {useText ? <p className="text-body-large">{useText}</p> : null}
      <GalleryWorkOutline definition={copy.definition} sources={galleryPreviewSources(preview)} />
      <GalleryFocusedAdjustments copy={copy} preview={preview} choices={choices} />
    </section>
  );
}
function ReviewHeader({ workspaceName }: { readonly workspaceName: string }): JSX.Element {
  return (
    <header className="flex min-w-0 flex-col gap-2">
      <p className="text-label-large">Review for {workspaceName}</p>
      <h1 className="text-headline-medium">Review your starting work</h1>
    </header>
  );
}
/** Review exact roots, required copies, actual rewritten structure and explicit publication visibility. */
export function GalleryReview(props: GalleryReviewProps): JSX.Element {
  const [inspecting, setInspecting] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
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
  const published = props.preview.mode === 'published';
  const busy = props.state.pending || props.state.updating || props.state.blocked;
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
        <div className="flex min-w-0 flex-col gap-5" aria-busy={busy}>
          <ReviewHeader workspaceName={props.workspaceName} />
          <GalleryReviewOrganization
            preview={props.preview}
            selectedItems={props.selectedItems}
            outcomes={props.outcomes}
            onInspect={inspect}
          />
          <GalleryRequiredCopies preview={props.preview} onInspect={inspect} />
          <GalleryDestination props={props} />
          {props.state.error ? (
            <InlineBanner
              tone="critical"
              title={published ? 'Could not add these templates' : 'Could not keep these drafts'}
            >
              {props.state.error}
            </InlineBanner>
          ) : null}
          {props.state.updating ? <p role="status">Updating the review…</p> : null}
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="ghost" disabled={props.state.pending} onClick={props.onBack}>
              Back to selection
            </Button>
            <Button
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
                  ? `Add to ${props.workspaceName}`
                  : 'Keep private drafts'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
