'use client';
import type { JSX } from 'react';
import type { WorkTemplateCopyBundle } from '@docket/work/template-gallery-contract';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Surface,
} from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import Link from '@/components/docket-link';
import { GalleryBundleUndo, type GalleryBundleUndoState } from './gallery-bundle-undo';
import { workTemplateHref } from '../work-template-navigation';

import { galleryBundleDependencies, galleryBundleConsumers } from './gallery-bundle-dependencies';

type Entry = WorkTemplateCopyBundle['entries'][number];
function BundleEntry({
  entry,
  bundle,
  orgId,
}: {
  readonly entry: Entry;
  readonly bundle: WorkTemplateCopyBundle;
  readonly orgId: string;
}): JSX.Element {
  const noun = useVocabulary(entry.template?.targetType ?? 'task');
  if (!entry.template)
    return (
      <li className="py-3">
        <p className="text-body-medium">This template is no longer available.</p>
      </li>
    );
  const dependencies = galleryBundleDependencies(entry, bundle);
  return (
    <li className="flex min-w-0 flex-col gap-1 py-3">
      <Link
        className="text-title-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
        href={`${workTemplateHref(orgId)}/${entry.workTypeId}?returnBundle=${bundle.receipt.bundleId}`}
      >
        {entry.template.definition.name}
      </Link>
      <p className="text-body-small text-on-surface-variant">
        {noun} ·{' '}
        {entry.template.status === 'archived'
          ? 'Archived'
          : entry.reservation.state === 'void'
            ? 'Removed from this copy'
            : entry.reservation.state === 'pending'
              ? 'Unpublished draft'
              : entry.template.latestVersion
                ? `Published · Version ${entry.template.latestVersion.number}`
                : 'Shared template kept'}
      </p>
      {dependencies.unpublished.length ? (
        <p className="text-body-medium">
          Publish {dependencies.unpublished.join(' and ')} before this template.
        </p>
      ) : null}
      {dependencies.requiresReview && entry.template.status !== 'archived' ? (
        <p className="text-body-medium">Review the included templates before sharing this one.</p>
      ) : null}
      {entry.catalogOrigin ? (
        <p className="text-body-small text-on-surface-variant">
          Independent copy from the Docket gallery
        </p>
      ) : null}
    </li>
  );
}
/** First currently editable unpublished dependency whose own required definitions are already published. */
export function nextGalleryDraft(bundle: WorkTemplateCopyBundle): Entry | undefined {
  if (bundle.receipt.state === 'undone') return undefined;
  return bundle.entries.find((entry) => {
    if (
      entry.reservation.state !== 'pending' ||
      !entry.template?.canEdit ||
      entry.template.status === 'archived'
    )
      return false;
    const dependencies = galleryBundleDependencies(entry, bundle);
    return !dependencies.requiresReview && dependencies.unpublished.length === 0;
  });
}
/** Durable private bundle reentry reads current canonical drafts and never invents a first publication. */
export function GalleryCopyBundle({
  bundle,
  orgId,
  onNew,
  undo,
}: {
  readonly bundle: WorkTemplateCopyBundle;
  readonly orgId: string;
  readonly onNew: () => void;
  readonly undo?: GalleryBundleUndoState;
}): JSX.Element {
  const next = nextGalleryDraft(bundle);
  const roots = bundle.entries.filter((entry) => entry.isRoot),
    required = bundle.entries.filter((entry) => !entry.isRoot);
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:gap-5">
      <BundleNextReview bundle={bundle} next={next} orgId={orgId} onNew={onNew} />
      <Surface as="section" shape="medium" pad="comfortable" aria-label="Selected templates">
        <h2 className="text-title-large">Selected templates</h2>
        <ul>
          {roots.map((entry) => (
            <BundleEntry key={entry.key} entry={entry} bundle={bundle} orgId={orgId} />
          ))}
        </ul>
      </Surface>
      {required.length ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button wrapLabel variant="ghost" className="px-3 sm:px-0">
              Included templates ({required.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="px-3 sm:px-0">
              {required.map((entry) => (
                <BundleEntry key={entry.key} entry={entry} bundle={bundle} orgId={orgId} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {undo ? <GalleryBundleUndo bundle={bundle} state={undo} orgId={orgId} /> : null}
    </div>
  );
}

function BundleNextReview({
  bundle,
  next,
  orgId,
  onNew,
}: {
  readonly bundle: WorkTemplateCopyBundle;
  readonly next: Entry | undefined;
  readonly orgId: string;
  readonly onNew: () => void;
}): JSX.Element {
  const undone = bundle.receipt.state === 'undone';
  const consumers = next ? galleryBundleConsumers(next, bundle) : [];
  return (
    <Surface
      as="header"
      tone="prominent"
      shape="medium"
      pad="comfortable"
      className="flex flex-col gap-3"
    >
      <h2 className="text-title-large">
        {undone ? 'This copy was undone' : next ? 'Continue setup' : 'Saved templates'}
      </h2>
      <p className="text-body-medium">{nextReviewInstructions(undone, consumers)}</p>
      {next ? (
        <Button wrapLabel asChild className="self-start">
          <Link
            href={`${workTemplateHref(orgId)}/${next.workTypeId}?section=review&returnBundle=${bundle.receipt.bundleId}`}
          >
            Review {(next.template?.draftDefinition ?? next.template?.definition)?.name}
          </Link>
        </Button>
      ) : null}
      {undone ? (
        <Button wrapLabel className="self-start" onClick={onNew}>
          Choose starting points
        </Button>
      ) : null}
      <p className="text-body-small text-on-surface-variant">Only you can see this copy review</p>
    </Surface>
  );
}

function nextReviewInstructions(undone: boolean, consumers: readonly string[]): string {
  if (undone)
    return 'Templates already used or edited stay available. Choose starting points to make another copy.';
  if (!consumers.length) return 'Open a saved template to continue setup.';
  return `${consumers.join(' and ')} ${consumers.length === 1 ? 'uses' : 'use'} this template. Review and share it first.`;
}
