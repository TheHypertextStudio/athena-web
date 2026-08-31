import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { type LifecycleState, lifecycleBadgeVariant, lifecycleLabel } from '@/lib/lifecycle';

/** Props for {@link LifecycleBadge}. */
export interface LifecycleBadgeProps {
  /** The lifecycle state to render. */
  readonly state: LifecycleState;
}

/**
 * An organization's data-lifecycle state, as a readable pill.
 *
 * @remarks
 * A {@link Badge} rather than a `Chip`: the state is something to read, not something to press.
 *
 * @param props - See {@link LifecycleBadgeProps}.
 * @returns the lifecycle-state pill.
 */
export function LifecycleBadge({ state }: LifecycleBadgeProps): JSX.Element {
  return <Badge variant={lifecycleBadgeVariant(state)}>{lifecycleLabel(state)}</Badge>;
}
