'use client';
import type { JSX } from 'react';
import type {
  WorkTemplateGalleryItem,
  WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Surface,
} from '@docket/ui/primitives';
import { ChevronDown, ChevronRight } from '@docket/ui/icons';
import { useVocabulary } from '@docket/ui/hooks';
import { gallerySourceKey } from './gallery-metadata';

import {
  galleryReviewGroups,
  type GalleryReviewOutcome,
  type GalleryReviewedCopy,
} from './gallery-review-groups';
export type { GalleryReviewedCopy } from './gallery-review-groups';
interface OrganizationProps {
  readonly preview: WorkTemplateGalleryPreview;
  readonly selectedItems: readonly WorkTemplateGalleryItem[];
  readonly outcomes?: readonly GalleryReviewOutcome[] | undefined;
  readonly onInspect: (copy: GalleryReviewedCopy) => void;
}
function ReviewedWorkButton({
  copy,
  onInspect,
  prominent = false,
}: {
  readonly copy: GalleryReviewedCopy;
  readonly onInspect: OrganizationProps['onInspect'];
  readonly prominent?: boolean;
}): JSX.Element {
  return (
    <Button
      variant="ghost"
      aria-label={`Inspect ${copy.name}`}
      className="h-auto min-h-10 w-full justify-between px-0 text-left whitespace-normal"
      onClick={() => {
        onInspect(copy);
      }}
    >
      <span className={prominent ? 'text-title-large' : 'text-title-medium'}>{copy.name}</span>
      <span
        aria-hidden="true"
        className="text-label-medium text-on-surface-variant flex shrink-0 items-center gap-1"
      >
        Inspect <ChevronRight className="size-4" />
      </span>
    </Button>
  );
}
function WorkCopySummary({ copy }: { readonly copy: GalleryReviewedCopy }): JSX.Element | null {
  const items = copy.includedCount ?? 0,
    routines = copy.definition.defaultSchedules.length;
  const parts = [
    items ? `${items} included items` : '',
    routines ? `${routines} recurring routines` : '',
  ].filter(Boolean);
  return parts.length ? (
    <p className="text-body-small text-on-surface-variant px-0">{parts.join(' · ')}</p>
  ) : null;
}
function KindRows({
  kind,
  copies,
  onInspect,
  showKind = true,
}: {
  readonly showKind?: boolean;
  readonly kind: GalleryReviewedCopy['targetType'];
  readonly copies: readonly GalleryReviewedCopy[];
  readonly onInspect: OrganizationProps['onInspect'];
}): JSX.Element | null {
  const noun = useVocabulary(kind, { plural: true });
  if (!copies.length) return null;
  return (
    <section aria-label={noun} className="py-3">
      {showKind ? (
        <p className="text-label-medium text-on-surface-variant">
          {noun} ({copies.length})
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {copies.map((copy) => (
          <li key={gallerySourceKey(copy.source)}>
            <ReviewedWorkButton copy={copy} onInspect={onInspect} />
            <WorkCopySummary copy={copy} />
            {copy.use ? (
              <p className="text-body-medium text-on-surface-variant px-0 pb-2">{copy.use}</p>
            ) : null}
            {copy.adjustmentCount ? (
              <p className="text-body-small text-on-surface-variant px-0 pb-2">
                {copy.adjustmentCount} optional adjustments · Open to review
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
function CategoryGroup({
  name,
  copies,
  onInspect,
  open,
}: {
  readonly name: string;
  readonly copies: readonly GalleryReviewedCopy[];
  readonly onInspect: OrganizationProps['onInspect'];
  readonly open: boolean;
}): JSX.Element {
  return (
    <Surface as="section" shape="medium" pad="comfortable" aria-label={name}>
      <Collapsible defaultOpen={open}>
        <h3 className="text-title-large">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto min-h-10 w-full justify-between px-0 text-left whitespace-normal"
            >
              <span className="text-title-large">{name}</span>{' '}
              <span className="text-label-medium text-on-surface-variant">
                {copies.length} selected
              </span>
            </Button>
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent>
          {(['initiative', 'program', 'project', 'task'] as const).map((kind) => (
            <KindRows
              key={kind}
              kind={kind}
              copies={copies.filter((copy) => copy.targetType === kind)}
              onInspect={onInspect}
              showKind={new Set(copies.map((copy) => copy.targetType)).size > 1}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}
/** Group complete reviewed selections by actual category and work kind, without mounting every outline. */
export function GalleryReviewOrganization({
  preview,
  selectedItems,
  onInspect,
  outcomes,
}: OrganizationProps): JSX.Element {
  const groups = galleryReviewGroups(preview, selectedItems, outcomes);
  const selectedCount = preview.roots.length;
  return (
    <section aria-label="Selected templates" className="flex min-w-0 flex-col gap-3">
      <p className="text-body-medium text-on-surface-variant px-3 sm:px-0">
        {selectedCount} selected · {preview.copies.length} templates
      </p>
      {selectedCount === 1 ? (
        <Surface as="section" shape="medium" pad="comfortable">
          {groups
            .flatMap((group) => group.copies)
            .map((copy) => (
              <div key={gallerySourceKey(copy.source)}>
                <h2 className="text-title-large">
                  <ReviewedWorkButton copy={copy} onInspect={onInspect} prominent />
                </h2>
                <WorkCopySummary copy={copy} />
                {copy.use ? (
                  <p className="text-body-medium text-on-surface-variant px-0">{copy.use}</p>
                ) : null}
                {copy.adjustmentCount ? (
                  <p className="text-body-small text-on-surface-variant px-0 pt-2">
                    {copy.adjustmentCount} optional adjustments · Open to review
                  </p>
                ) : null}
              </div>
            ))}
        </Surface>
      ) : (
        groups.map((group, index) => (
          <CategoryGroup
            key={group.name}
            {...group}
            onInspect={onInspect}
            open={selectedCount <= 6 || index === 0}
          />
        ))
      )}
    </section>
  );
}
/** Keep required copies subordinate and explain their actual known dependencies on demand. */
export function GalleryRequiredCopies({
  preview,
  onInspect,
}: Pick<OrganizationProps, 'preview' | 'onInspect'>): JSX.Element | null {
  const roots = new Set(preview.roots.map(gallerySourceKey));
  const required = preview.copies.filter((copy) => !roots.has(gallerySourceKey(copy.source)));
  if (!required.length) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="group h-auto min-h-10 gap-2 px-3 text-left whitespace-normal sm:px-0"
        >
          <ChevronDown
            aria-hidden="true"
            className="size-5 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
          <span>
            {required.length} required {required.length === 1 ? 'template' : 'templates'}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section aria-label="Required templates" className="px-3 sm:px-0">
          <p className="text-body-medium text-on-surface-variant">
            Templates used in more than one place are copied once.
          </p>
          <ul className="pl-3">
            {required.map((copy) => (
              <li key={gallerySourceKey(copy.source)} className="py-2">
                <Button
                  variant="ghost"
                  className="px-0"
                  onClick={() => {
                    onInspect(copy);
                  }}
                >
                  {copy.name}
                </Button>
                <p className="text-body-small text-on-surface-variant">
                  Used by{' '}
                  {preview.copies
                    .filter((parent) =>
                      parent.dependencies.some(
                        (identity) => gallerySourceKey(identity) === gallerySourceKey(copy.source),
                      ),
                    )
                    .map((parent) => parent.name)
                    .join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
