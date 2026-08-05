/**
 * `/time` — where a person looks back at where their time went.
 *
 * @remarks
 * Cross-workspace by design, and therefore un-nested: the Time Ledger is Hub-owned, so "my week"
 * spans every workspace a person belongs to. Nesting it under `/orgs/:orgId` would silently
 * answer a narrower question than the one being asked.
 */
import type { JSX } from 'react';

import TimeClient from './time-client';

/** Static metadata for the time-reports surface. */
export const metadata = { title: 'Time · Docket' };

/**
 * The time-reports page.
 *
 * @returns the analytics surface plus the current-task share controls.
 */
export default function TimePage(): JSX.Element {
  return <TimeClient />;
}
