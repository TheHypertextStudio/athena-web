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
import { sectionHref } from '@/components/settings/settings-registry';

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
        <p className="text-body-medium">This definition is no longer available.</p>
      </li>
    );
  const dependencies = galleryBundleDependencies(entry, bundle);
  return (
    <li className="flex min-w-0 flex-col gap-1 py-3">
      <Link
        className="text-title-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
        href={`${sectionHref(orgId, 'templates')}/${entry.workTypeId}`}
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
                : 'Publication retained'}
      </p>
      {dependencies.unpublished.length ? (
        <p className="text-body-medium">
          Publish {dependencies.unpublished.join(' and ')} before this definition.
        </p>
      ) : null}
      {dependencies.requiresReview && entry.template.status !== 'archived' ? (
        <p className="text-body-medium">
          Review the referenced definitions in the editor before publishing.
        </p>
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
    <div className="flex min-w-0 flex-col gap-5">
      <BundleNextReview bundle={bundle} next={next} orgId={orgId} onNew={onNew} />
      <Surface as="section" shape="large" pad="roomy" aria-label="Selected definitions">
        <h2 className="text-title-large">Chosen work</h2>
        <ul>
          {roots.map((entry) => (
            <BundleEntry key={entry.key} entry={entry} bundle={bundle} orgId={orgId} />
          ))}
        </ul>
      </Surface>
      {undo ? <GalleryBundleUndo bundle={bundle} state={undo} /> : null}
      {required.length ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost">Required definitions ({required.length})</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul>
              {required.map((entry) => (
                <BundleEntry key={entry.key} entry={entry} bundle={bundle} orgId={orgId} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
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
    <Surface as="header" tone="prominent" shape="large" pad="roomy" className="flex flex-col gap-3">
      <h2 className="text-title-large">
        {undone ? 'This copy was undone' : next ? 'Continue defining' : 'Saved definitions'}
      </h2>
      <p className="text-body-medium">{nextReviewInstructions(undone, consumers)}</p>
      {next ? (
        <Button asChild className="self-start">
          <Link href={`${sectionHref(orgId, 'templates')}/${next.workTypeId}?section=review`}>
            Review {(next.template?.draftDefinition ?? next.template?.definition)?.name}
          </Link>
        </Button>
      ) : null}
      {undone ? (
        <Button className="self-start" onClick={onNew}>
          Choose starting work
        </Button>
      ) : null}
      <p className="text-body-small text-on-surface-variant">Only you can see this copy review</p>
    </Surface>
  );
}

function nextReviewInstructions(undone: boolean, consumers: readonly string[]): string {
  if (undone)
    return 'Used or edited definitions stay available. Choose starting work to make another copy.';
  if (!consumers.length) return 'Open a saved definition to review its current state.';
  return `${consumers.join(' and ')} ${consumers.length === 1 ? 'uses' : 'use'} this definition. Review and publish it first.`;
}
