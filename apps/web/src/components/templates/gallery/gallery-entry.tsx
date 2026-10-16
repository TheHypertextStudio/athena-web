'use client';
import type { JSX } from 'react';
import type { WorkTemplateGalleryDetail } from '@docket/work/template-gallery-contract';
import { Button, Surface } from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import { GalleryWorkOutline } from './gallery-work-outline';

/** Real catalog detail with an explicit selection action and honest immutable release provenance. */
export function GalleryEntry({
  detail,
  selected,
  selectionFull = false,
  onSelect,
  onBack,
  onReview,
}: {
  readonly detail: WorkTemplateGalleryDetail;
  readonly selected: boolean;
  readonly selectionFull?: boolean;
  readonly onSelect: () => void;
  readonly onBack: () => void;
  readonly onReview?: () => void;
}): JSX.Element {
  const kind = useVocabulary(detail.targetType);
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:gap-5">
      <Button variant="ghost" className="self-start px-3 sm:px-0" onClick={onBack}>
        Back to gallery
      </Button>
      <Surface
        as="header"
        tone="prominent"
        shape="medium"
        pad="comfortable"
        className="flex min-w-0 flex-col gap-2"
      >
        <p className="text-label-large">{kind} · Docket gallery</p>
        <h1 className="text-title-large sm:text-headline-large break-words">{detail.name}</h1>
        {onReview && (selected || selectionFull) ? (
          <Button className="self-start" onClick={onReview}>
            Review selection
          </Button>
        ) : null}
        <Button
          disabled={selectionFull && !selected}
          variant={selected ? 'ghost' : 'default'}
          className="self-start"
          onClick={onSelect}
        >
          {selected ? 'Remove from selection' : 'Select this template'}
        </Button>
      </Surface>
      <p className="text-body-medium px-3 sm:px-0">{detail.use}</p>
      {selectionFull && !selected ? (
        <p className="text-body-medium px-3 sm:px-0">
          Review or remove some selected work before adding another template.
        </p>
      ) : null}
      <GalleryWorkOutline definition={detail.definition} sources={[detail, ...detail.references]} />
    </div>
  );
}
