import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { type ProbeOutcome, outcomeBadgeVariant, outcomeLabel } from '@/lib/service-status';

/** Props for {@link OutcomeBadge}. */
export interface OutcomeBadgeProps {
  /** The health verdict to render. */
  readonly outcome: ProbeOutcome;
}

/**
 * A service's health verdict, as a readable pill.
 *
 * @remarks
 * A {@link Badge} rather than a hand-built span: the shared primitive already owns the pill's
 * radius, padding, and type scale, so the status board cannot drift away from every other pill in
 * the console the next time one of those changes.
 *
 * @param props - See {@link OutcomeBadgeProps}.
 * @returns the verdict pill.
 */
export function OutcomeBadge({ outcome }: OutcomeBadgeProps): JSX.Element {
  return <Badge variant={outcomeBadgeVariant(outcome)}>{outcomeLabel(outcome)}</Badge>;
}
