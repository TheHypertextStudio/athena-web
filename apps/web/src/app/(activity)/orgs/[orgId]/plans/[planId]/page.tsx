/**
 * The planning canvas route — server entry.
 *
 * @remarks
 * The plan is personal and volatile, so there is nothing worth prefetching on the server: the
 * client reads it through the live query the moment it mounts, and offline the route table mounts
 * {@link PlanClient} directly.
 */
import type { JSX } from 'react';

import PlanClient from './plan-client';

/** The planning canvas page (Server Component). */
export default function PlanPage(): JSX.Element {
  return <PlanClient />;
}
