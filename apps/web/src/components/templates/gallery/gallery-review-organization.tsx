'use client';
import type { TemplateCopyReview } from './gallery-review-types';
import type { JSX } from 'react';
import type { WorkTemplateGalleryItem } from '@docket/work/template-gallery-contract';
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
  readonly preview: TemplateCopyReview;
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
      wrapLabel
      variant="ghost"
      aria-label={`Inspect ${copy.name}`}
      className="min-h-10 w-full flex-col items-start gap-1 px-0 text-left sm:flex-row sm:items-center sm:justify-between"
      onClick={() => {
        onInspect(copy);
      }}
    >
      <span
        className={
          prominent
            ? 'text-title-large min-w-0 flex-1 break-words'
            : 'text-title-medium min-w-0 flex-1 break-words'
        }
      >
        {copy.name}
      </span>
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
  const kind = useVocabulary(copy.targetType);
  const parts = [
    kind,
    items ? `${items} included items` : '',
    routines ? `${routines} recurring routines` : '',
  ].filter(Boolean);
  return parts.length ? (
    <p className="text-body-small text-on-surface-variant px-0">{parts.join(' · ')}</p>
  ) : null;
}
function ReviewedCopyRows({
  copies,
  onInspect,
}: {
  readonly copies: readonly GalleryReviewedCopy[];
  readonly onInspect: OrganizationProps['onInspect'];
}): JSX.Element {
  return (
    <ul className="flex flex-col gap-3 py-3">
      {copies.map((copy) => (
        <li key={gallerySourceKey(copy.source)}>
          <ReviewedWorkButton copy={copy} onInspect={onInspect} />
          <WorkCopySummary copy={copy} />
          {copy.use ? (
            <p className="text-body-medium text-on-surface-variant pb-2">{copy.use}</p>
          ) : null}
          {copy.adjustmentCount ? (
            <p className="text-body-small text-on-surface-variant pb-2">
              {copy.adjustmentCount} {copy.adjustmentCount === 1 ? 'change' : 'changes'} to review
            </p>
          ) : null}
        </li>
      ))}
    </ul>
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
          <ReviewedCopyRows copies={copies} onInspect={onInspect} />
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}
/** Group complete reviewed selections by purpose, with each kind beside its actual work. */
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
                    {copy.adjustmentCount} {copy.adjustmentCount === 1 ? 'change' : 'changes'} to
                    review
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
