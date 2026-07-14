'use client';

/**
 * `settings` — the Settings header subtitle, gated on the active workspace kind.
 *
 * @remarks
 * The Settings layout is a Server Component, but the subtitle copy depends on whether the
 * active workspace is the caller's **personal** space — which is only known client-side via the
 * shell-wide {@link useActiveOrg} context. This tiny client component owns just that one line so
 * the layout itself stays a thin Server Component. Both variants stay explicitly workspace-scoped
 * because caller-owned account and Athena preferences live in the global Settings hierarchy.
 */
import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';

/** The shared-workspace subtitle. */
const SHARED_WORKSPACE_SUBTITLE = "Manage this workspace's identity, people, and workflows.";
/** The personal-workspace subtitle. */
const PERSONAL_WORKSPACE_SUBTITLE = "Manage this workspace's identity, structure, and imports.";

/**
 * The Settings header subtitle line.
 *
 * @returns the rendered subtitle, conditional on the active workspace kind.
 */
export function SettingsHeaderSubtitle(): JSX.Element {
  const { activeOrg } = useActiveOrg();
  const subtitle = activeOrg?.isPersonal ? PERSONAL_WORKSPACE_SUBTITLE : SHARED_WORKSPACE_SUBTITLE;

  return <p className="text-on-surface-variant text-body-medium">{subtitle}</p>;
}
