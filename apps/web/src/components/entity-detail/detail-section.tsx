'use client';

/**
 * A titled section in an entity detail page's body.
 *
 * @remarks
 * The frame every body section shares, per `docs/design/references/detail-page-layout.md`: a 36px
 * heading row carrying the label, an optional count, and the section's own actions at the end;
 * then the content, 8px below. The section is flat — no card, border, or resting background — so
 * its left and right edges are the body column's, and the description above it and every section
 * below share one alignment. An empty section is its heading and its actions, with no sentence.
 */
import { cn } from '@docket/ui/lib/utils';
import type { JSX, ReactNode } from 'react';

/** Props for {@link DetailSection}. */
export interface DetailSectionProps {
  /** Names the section; the heading carries the id `${id}-heading`. */
  readonly id: string;
  readonly title: string;
  /** A count shown beside the title (e.g. `2/5`, `3`). Omitted when there is nothing to count. */
  readonly count?: ReactNode;
  /** Icon buttons and menus at the end of the heading row. */
  readonly actions?: ReactNode;
  /** The section's rows. Omit for an empty section. */
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * Render a flat detail-page section.
 *
 * @param props - See {@link DetailSectionProps}.
 * @returns a labelled `section`.
 */
export function DetailSection({
  id,
  title,
  count,
  actions,
  children,
  className,
}: DetailSectionProps): JSX.Element {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      data-detail-section={id}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      <div className="flex h-9 min-w-0 items-center gap-2">
        <h2 id={headingId} className="text-title-small text-on-surface truncate">
          {title}
        </h2>
        {count === undefined || count === null ? null : (
          <span className="text-on-surface-variant text-body-medium tabular-nums">{count}</span>
        )}
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
