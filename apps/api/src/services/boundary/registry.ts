/**
 * `@docket/api` — which day-boundary client, if any, this deployment can reach.
 *
 * @remarks
 * There is no boundary endpoint reachable from Docket's API today, so the honest default is
 * **none**: {@link getDayBoundaryPort} returns null, and every caller treats that as "this
 * deployment cannot ask for evening, so do not try." That is a configuration state, not an
 * unfinished code path — the sweep's behaviour with no port installed is complete and correct
 * (it does nothing), and installing one is a deployment concern, not a code change.
 *
 * A single process-wide port is deliberate for now, and it is the piece that has to change
 * before this ships to more than one person: binding a *particular* Hub to a *particular*
 * device has no representation here yet, because no pairing path exists on either side to
 * represent. See `docs/engineering/specs/curfew-integration.md` §7 for the rest of that gap.
 */
import type { DayBoundaryPort } from './port';

let installed: DayBoundaryPort | null = null;

/**
 * Install (or remove) the boundary client this process can reach.
 *
 * @param port - The adapter, or null to remove it.
 */
export function setDayBoundaryPort(port: DayBoundaryPort | null): void {
  installed = port;
}

/**
 * The boundary client this process can reach, if any.
 *
 * @returns the installed port, or null when this deployment has none.
 */
export function getDayBoundaryPort(): DayBoundaryPort | null {
  return installed;
}
