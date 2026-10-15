'use client';
import type { JSX, ReactNode } from 'react';

/** Keep identity and child review in the composer's leading row, outside collapsible properties. */
export function ComposerTemplateRow({
  selection,
  review,
}: {
  readonly selection: ReactNode;
  readonly review: ReactNode;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Work template"
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      {selection}
      {review}
    </div>
  );
}
