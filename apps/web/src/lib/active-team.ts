/**
 * `sessionStorage` key prefix for an org's remembered default team id.
 *
 * @remarks
 * Creating a task requires a `teamId`, but the RPC surface exposes no teams-list route —
 * the only team id a fresh user has is the `defaultTeam.id` returned by
 * `POST /v1/orgs`. Onboarding stashes it here so the org work view can create tasks
 * immediately after onboarding; on a later direct visit the work view recovers a team id
 * from an existing task instead (see `org/[orgId]/page.tsx`).
 */
const TEAM_KEY_PREFIX = 'docket.defaultTeam.';

/**
 * Remember an org's default team id for the current browser session.
 *
 * @param orgId - The organization the team belongs to.
 * @param teamId - The org's default team id (from the org-create result).
 */
export function rememberDefaultTeam(orgId: string, teamId: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(`${TEAM_KEY_PREFIX}${orgId}`, teamId);
}

/**
 * Recall an org's remembered default team id, if one was stored this session.
 *
 * @param orgId - The organization to look up.
 * @returns the remembered team id, or `null` when none is stored.
 */
export function recallDefaultTeam(orgId: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(`${TEAM_KEY_PREFIX}${orgId}`);
}
