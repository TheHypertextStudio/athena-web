/** Stable monitor URLs for queued Athena session work. */
import { resourceUrl } from '../lib/ok';

/** Return the absolute monitor URL for personal Athena work. */
export function personalSessionMonitor(sessionId: string): string {
  return resourceUrl(`/v1/me/athena/sessions/${encodeURIComponent(sessionId)}`);
}

/** Return the absolute monitor URL for organization-scoped Athena work. */
export function organizationSessionMonitor(organizationId: string, sessionId: string): string {
  return resourceUrl(
    `/v1/orgs/${encodeURIComponent(organizationId)}/sessions/${encodeURIComponent(sessionId)}`,
  );
}
