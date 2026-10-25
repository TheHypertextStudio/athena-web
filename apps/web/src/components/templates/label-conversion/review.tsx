import { useEffect, useRef, type JSX } from 'react';
import { useVocabulary } from '@docket/ui/hooks';
import type { LabelTemplateConversionReview } from '@docket/work/work-template-contract';
import { Surface } from '@docket/ui/primitives';
/** Present the exact server-checked changes before the explicit commit. */
export function ConversionReview({
  review,
}: {
  readonly review: LabelTemplateConversionReview;
}): JSX.Element {
  const first = review.items[0],
    kind = first?.kind ?? 'task';
  const noun = useVocabulary(kind, { plural: review.items.length !== 1 }).toLocaleLowerCase();
  const sameTemplate = review.items.every(
    (item) =>
      item.workTypeId === first?.workTypeId && item.workTypeVersionId === first.workTypeVersionId,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [review.reviewFingerprint]);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="space-y-2">
        <p className="text-label-large text-primary">2 of 2 · Review</p>
        <h1 ref={heading} tabIndex={-1} className="text-headline-small break-words outline-none">
          Apply {sameTemplate ? first?.templateName : 'these templates'} to {review.items.length}{' '}
          {noun}?
        </h1>
        <p className="text-body-medium text-on-surface-variant">
          Only the labels shown below will be removed. Descriptions, dates and contained work stay
          as they are.
        </p>
      </header>
      <Surface
        tone="card"
        pad="none"
        shape="none"
        className="sm:rounded-corner-md -mx-3 min-w-0 overflow-hidden sm:mx-0"
      >
        <ul className="divide-outline-variant divide-y">
          {review.items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="min-w-0 space-y-2 px-3 py-4 sm:px-4">
              <h2 className="text-title-medium break-words">{item.name}</h2>
              <dl className="text-body-medium grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                {!sameTemplate ? (
                  <>
                    <dt className="text-on-surface-variant">Template</dt>
                    <dd className="break-words">{item.templateName}</dd>
                  </>
                ) : null}
                <dt className="text-on-surface-variant">Remove</dt>
                <dd className="break-words">
                  {item.removeLabels.map((label) => label.name).join(', ')}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      </Surface>
      <p className="text-body-small text-on-surface-variant">
        You can undo this batch if the affected work hasn’t changed afterward.
      </p>
    </div>
  );
}
