/**
 * `settings` — the Connections section a nested connector page belongs to.
 *
 * @remarks
 * Connections exists twice by design: once in the Personal group (the caller's own data sources)
 * and once in the Workspace group (a shared org's). A personal workspace has only the first — the
 * registry deliberately omits the workspace copy there, because a personal workspace's data
 * sources *are* the caller's.
 *
 * The connector pages nested under Connections did not know that. Notion and the workspace Google
 * Calendar page always pointed at `/orgs/:id/settings/connections`, which on a personal workspace
 * is a route that renders but has no nav row: opening it left every nav item unhighlighted, so the
 * settings modal showed you a page and simultaneously claimed you were nowhere. Going "back" from
 * Notion made it worse, landing you on the duplicate Connections the product had decided not to
 * show you.
 *
 * Resolving the parent from the workspace kind means a nested page's way out is always a section
 * the nav can highlight.
 */
import { useSettingsShellWorkspace } from './settings-shell-nav';
import type { SettingsSectionParent } from './settings-section-page';

/**
 * The Connections section to send a nested connector page back to.
 *
 * @param orgId - The workspace whose settings the nested page is under.
 * @returns the parent descriptor for {@link SettingsSectionPage}.
 */
export function useConnectionsParent(orgId: string): SettingsSectionParent {
  const { isPersonal } = useSettingsShellWorkspace();
  return {
    label: 'Connections',
    href: isPersonal ? '/settings/connections' : `/orgs/${orgId}/settings/connections`,
  };
}
