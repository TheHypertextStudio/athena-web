import { redirect } from 'next/navigation';

import {
  DEFAULT_PERSONAL_SETTINGS_SECTION,
  personalSectionHref,
} from '@/components/settings/settings-registry';

/**
 * Send the global Settings root to the first user-owned destination.
 *
 * @remarks
 * This covers a *direct* arrival at `/settings` — a typed URL, a bookmark, a deep link. In-app
 * affordances navigate to the resolved destination themselves rather than bouncing through here:
 * a server redirect is not reliably observed across a client-side router transition, which left
 * the account menu parked on `/settings` with no section selected.
 */
export default function GlobalSettingsRootPage(): never {
  redirect(personalSectionHref(DEFAULT_PERSONAL_SETTINGS_SECTION));
}
