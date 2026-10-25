import type { JSX } from 'react';
import type { LabelTemplateSuggestionPreview } from '@docket/work/template-gallery-contract';

/** Show only the exact server-checked examples before requesting generation. */
export function LabelSuggestionReview({
  review,
}: {
  readonly review: LabelTemplateSuggestionPreview;
}): JSX.Element {
  return (
    <section aria-label="Selected examples" className="flex min-w-0 flex-col gap-4">
      <header className="space-y-2">
        <h2 className="text-title-large">
          Review {review.work.length} {review.work.length === 1 ? 'example' : 'examples'}
        </h2>
        <p className="text-body-medium text-on-surface-variant break-words">
          {review.labelGroup.name} · {review.label.name}
        </p>
      </header>
      <ul className="divide-outline-variant divide-y">
        {review.work.map((item) => (
          <li key={item.id} className="text-body-large py-3 break-words">
            {item.name}
          </li>
        ))}
      </ul>
      <p className="text-body-medium text-on-surface-variant">
        Athena will use these saved descriptions to suggest starting work. Review the proposal in
        Inbox before keeping a private draft. Your existing work and labels stay as they are.
      </p>
    </section>
  );
}
