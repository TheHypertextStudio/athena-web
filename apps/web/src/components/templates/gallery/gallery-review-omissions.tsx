'use client';
import type { JSX } from 'react';
import { labelsDef } from '@/components/labels/queries';
import { useApiQuery } from '@/lib/query';
import { gallerySourceKey } from './gallery-metadata';
import type { TemplateCopyReview } from './gallery-review-types';

type Omission = TemplateCopyReview['omissions'][number];
const labels = {
  label: 'Labels will be left out',
  image: 'Images will be left out',
  offering: 'Team availability will be left out',
  label_suggestion: 'Suggested label is not mapped',
  offering_suggestion: 'Suggested team offering is not confirmed',
};
/** Checked omissions name accessible source labels without exposing opaque workspace identifiers. */
export function GalleryReviewOmissions({
  preview,
  headingLevel = 2,
}: {
  readonly preview: TemplateCopyReview;
  readonly headingLevel?: 2 | 3;
}): JSX.Element | null {
  if (!preview.omissions.length) return null;
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section aria-label="Copy adjustments" className="min-w-0">
      <Heading className="text-title-medium">What changes in this copy</Heading>
      <ul className="flex flex-col gap-3">
        {preview.omissions.map((omission, index) => {
          const copy = preview.copies.find(
            (entry) => gallerySourceKey(entry.source) === gallerySourceKey(omission.source),
          );
          return (
            <li
              key={`${gallerySourceKey(omission.source)}:${index}`}
              className="min-w-0 break-words"
            >
              <p className="text-body-medium">
                {copy?.name}: {labels[omission.kind]}
                <OmissionName omission={omission} /> ({omission.count})
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
function OmissionName({ omission }: { readonly omission: Omission }): JSX.Element | null {
  if (!omission.value) return null;
  if (omission.kind === 'label' && omission.source.kind !== 'catalog')
    return <SourceLabelName orgId={omission.source.organizationId} id={omission.value} />;
  if (omission.kind === 'label_suggestion' || omission.kind === 'offering_suggestion')
    return <> — {omission.value}</>;
  return null;
}
function SourceLabelName({
  orgId,
  id,
}: {
  readonly orgId: string;
  readonly id: string;
}): JSX.Element | null {
  const query = useApiQuery(labelsDef(orgId));
  const label = query.data?.items.find((candidate) => candidate.id === id);
  return label ? <> — {label.name}</> : null;
}
