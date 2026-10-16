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
}: {
  readonly detail: WorkTemplateGalleryDetail;
  readonly selected: boolean;
  readonly selectionFull?: boolean;
  readonly onSelect: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  const kind = useVocabulary(detail.targetType);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Button variant="ghost" className="self-start" onClick={onBack}>
        Back to gallery
      </Button>
      <Surface
        as="header"
        tone="prominent"
        shape="large"
        pad="roomy"
        className="flex min-w-0 flex-col gap-3"
      >
        <p className="text-label-large">{kind} template</p>
        <h1 className="text-headline-large break-words">{detail.name}</h1>
        <p className="text-body-large">{detail.use}</p>
        <p className="text-body-small text-on-surface-variant">
          Independent copy from the Docket gallery
        </p>
        <Button
          disabled={selectionFull && !selected}
          variant={selected ? 'secondary' : 'default'}
          className="self-start"
          onClick={onSelect}
        >
          {selected ? 'Remove from selection' : 'Select this template'}
        </Button>
      </Surface>
      {selectionFull && !selected ? (
        <p className="text-body-medium">
          Review or remove some selected work before adding another definition.
        </p>
      ) : null}
      <GalleryWorkOutline definition={detail.definition} sources={[detail, ...detail.references]} />
    </div>
  );
}
