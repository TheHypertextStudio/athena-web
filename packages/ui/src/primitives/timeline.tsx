/** Ordered activity geometry: one chronological rail, anchored nodes and optional group stubs. */
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';
import { cn } from '../lib/utils';

/** An ordered timeline; item spacing belongs to the rail so connections remain continuous. */
export function Timeline({ className, ...props }: ComponentPropsWithoutRef<'ol'>): JSX.Element {
  return (
    <ol data-slot="timeline" className={cn('@container/timeline min-w-0', className)} {...props} />
  );
}

/** Geometry for one contribution, independent of the content or actor domain. */
export interface TimelineItemProps extends ComponentPropsWithoutRef<'li'> {
  readonly node: ReactNode;
  /** Connect a bounded group to the shared axis with a short orthogonal stub. */
  readonly connector?: boolean;
}

/** Anchor a contribution on the rail, trimming the rail at its first and last node centers. */
export function TimelineItem({
  node,
  connector = false,
  children,
  className,
  ...props
}: TimelineItemProps): JSX.Element {
  return (
    <li
      data-slot="timeline-item"
      data-connected={connector || undefined}
      className={cn(
        'before:bg-outline-variant relative min-w-0 pb-6 pl-10 before:absolute before:inset-y-0 before:left-3 before:w-px first:before:top-4 last:pb-0 last:before:bottom-[calc(100%-1rem)]',
        connector &&
          'after:bg-outline-variant after:absolute after:top-4 after:left-3 after:h-px after:w-7',
        className,
      )}
      {...props}
    >
      <span
        data-timeline-node
        aria-hidden="true"
        className="bg-surface absolute top-1 left-0 z-1 flex size-6 items-center justify-center"
      >
        {node}
      </span>
      <div className="relative z-1 min-w-0">{children}</div>
    </li>
  );
}

/** A compact geometric node for a timeline whose content already identifies its performer. */
export function TimelineMarker({
  className,
  ...props
}: ComponentPropsWithoutRef<'span'>): JSX.Element {
  return (
    <span data-slot="timeline-marker" className={cn('bg-outline size-2', className)} {...props} />
  );
}
