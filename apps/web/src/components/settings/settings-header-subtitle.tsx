'use client';

/**
 * `settings` — the Settings header subtitle, gated on the active workspace kind.
 *
 * @remarks
 * The Settings layout is a Server Component, but the subtitle copy depends on whether the
 * active workspace is the caller's **personal** space — which is only known client-side via the
 * shell-wide {@link useActiveOrg} context. This tiny client component owns just that one line so
 * the layout itself stays a thin Server Component: a personal workspace reads as *your space*
 * ("Manage your account, preferences, and connected tools."), while a shared org keeps the
 * organization framing. It falls back to the org copy while the active org is still loading.
 */
import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';

/** The org (shared-workspace) subtitle. */
const ORG_SUBTITLE = "Manage your organization's people, tools, and identity.";
/** The personal-workspace subtitle — framed as the user's own space, never an organization. */
const PERSONAL_SUBTITLE = 'Manage your account, preferences, and connected tools.';

/**
 * The Settings header subtitle line.
 *
 * @returns the rendered subtitle, conditional on the active workspace kind.
 */
export function SettingsHeaderSubtitle(): JSX.Element {
  const { activeOrg } = useActiveOrg();
  const subtitle = activeOrg?.isPersonal ? PERSONAL_SUBTITLE : ORG_SUBTITLE;

  return <p className="text-on-surface-variant text-body-medium">{subtitle}</p>;
}
