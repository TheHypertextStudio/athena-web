'use client';

/**
 * A compact pill rendering an Initiative's *rolled-up* health verdict.
 *
 * @remarks
 * The verdict is auto-derived (the worst of the associated children's health), so this pill
 * is read-only — there is no manual health field to edit on an Initiative. When no child
 * carries a verdict the roll-up is `null` and the pill reads a neutral "No verdict yet" so
 * the absence of signal is explicit rather than silently optimistic. Colors come from the
 * shared {@link HEALTH_PILL_CLASS} / {@link HEALTH_FILL_CLASS} token maps.
 */
import type { Health } from '@docket/types';
import { cn } from '@docket/ui';
import type { JSX } from 'react';

import { HEALTH_FILL_CLASS, HEALTH_LABEL, HEALTH_PILL_CLASS } from './health';

/** Props for {@link RolledUpHealthPill}. */
export interface RolledUpHealthPillProps {
  /** The rolled-up health verdict, or `null` when no child carries one. */
  health: Health | null;
  /** Optional extra classes (e.g. for sizing in dense rows). */
  className?: string;
}

/**
 * The rolled-up health pill.
 *
 * @param props - The {@link RolledUpHealthPillProps}.
 * @returns the rendered pill.
 */
export function RolledUpHealthPill({ health, className }: RolledUpHealthPillProps): JSX.Element {
  if (!health) {
    return (
      <span
        className={cn(
          'text-muted-foreground bg-muted ring-border inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
          className,
        )}
      >
        <span aria-hidden="true" className="bg-muted-foreground/60 size-1.5 rounded-full" />
        No verdict yet
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        HEALTH_PILL_CLASS[health],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', HEALTH_FILL_CLASS[health])} />
      {HEALTH_LABEL[health]}
    </span>
  );
}
