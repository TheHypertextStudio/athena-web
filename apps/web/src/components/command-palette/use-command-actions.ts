'use client';

import { DENSITIES, useContextState } from '@docket/ui/components';
import {
  Building,
  FolderKanban,
  GanttChart,
  Home,
  Inbox,
  Layers,
  ListChecks,
  LogOut,
  Plus,
  Settings,
  Sparkles,
  Target,
} from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { signOut } from '@/lib/auth-client';

import type { PaletteItem, PaletteScope } from './types';

/** The org-scoped sidebar destinations a command can jump to, with labels + glyphs. */
const ORG_DESTINATIONS = [
  { key: 'my-work', label: 'My Work', icon: ListChecks, keywords: ['tasks', 'assigned'] },
  { key: 'triage', label: 'Triage', icon: Inbox, keywords: ['inbox', 'unsorted'] },
  { key: 'initiatives', label: 'Initiatives', icon: Target, keywords: ['goals'] },
  { key: 'programs', label: 'Programs', icon: FolderKanban, keywords: ['streams'] },
  { key: 'projects', label: 'Projects', icon: FolderKanban, keywords: [] },
  { key: 'cycles', label: 'Cycles', icon: GanttChart, keywords: ['sprints'] },
  { key: 'agents', label: 'Agents', icon: Sparkles, keywords: ['ai', 'sessions'] },
  { key: 'settings', label: 'Settings', icon: Settings, keywords: ['preferences', 'org'] },
] as const;

/** Inputs the command builder needs from the palette host. */
interface CommandActionsInput {
  /** The active search scope (governs org-local navigation availability). */
  scope: PaletteScope;
  /** Close the palette; every command calls this immediately before navigating. */
  close: () => void;
}

/**
 * Build the palette's static commands: navigation jumps, actions, and org switches.
 *
 * @remarks
 * The non-search half of the palette. It assembles three sections, memoized against the
 * active-org state and scope:
 *
 * - **navigation** — the Hub destinations (Today, Inbox, Portfolio) always; when an org is
 *   bound (and the scope is `org`) the org-scoped sidebar destinations for that org, each
 *   org-chipped.
 * - **actions** — global actions (new organization, sign out).
 * - **organizations** — one "switch to <org>" command per membership, org-chipped.
 *
 * Every command closes the palette before performing its navigation/effect, so selection
 * feels instant and the overlay never lingers.
 *
 * @param input - The active scope and the palette's `close` callback.
 * @returns the static commands in display order (navigation → actions → organizations).
 */
export function useCommandActions({ scope, close }: CommandActionsInput): readonly PaletteItem[] {
  const router = useRouter();
  const { orgs, activeOrgId, orgName } = useActiveOrg();
  const { density, setDensity } = useContextState();

  return useMemo<readonly PaletteItem[]>(() => {
    /** Wrap a navigation in the close-then-push lifecycle every command shares. */
    const go = (href: string) => () => {
      close();
      router.push(href);
    };

    const items: PaletteItem[] = [];

    // ── Navigation: Hub destinations (always available) ──────────────────────
    items.push(
      {
        id: 'nav:today',
        section: 'navigation',
        label: 'Go to Today',
        hint: 'Hub',
        icon: Home,
        keywords: ['hub', 'home', 'plan', 'day'],
        run: go('/today'),
      },
      {
        id: 'nav:inbox',
        section: 'navigation',
        label: 'Go to Inbox',
        hint: 'Hub',
        icon: Inbox,
        keywords: ['notifications', 'unread', 'approvals'],
        run: go('/inbox'),
      },
      {
        id: 'nav:portfolio',
        section: 'navigation',
        label: 'Go to Portfolio',
        hint: 'Hub',
        icon: GanttChart,
        keywords: ['timeline', 'roadmap', 'programs', 'projects'],
        run: go('/portfolio'),
      },
    );

    // ── Navigation: org-scoped sections for the bound org (org scope only) ────
    if (scope === 'org' && activeOrgId) {
      const name = orgName(activeOrgId);
      for (const dest of ORG_DESTINATIONS) {
        items.push({
          id: `nav:org:${dest.key}`,
          section: 'navigation',
          label: dest.label,
          icon: dest.icon,
          keywords: dest.keywords,
          org: { id: activeOrgId, name },
          run: go(`/orgs/${activeOrgId}/${dest.key}`),
        });
      }
    }

    // ── Actions: global ───────────────────────────────────────────────────────
    items.push(
      {
        id: 'action:new-org',
        section: 'actions',
        label: 'Add a workspace',
        icon: Plus,
        keywords: ['create', 'join', 'organization', 'new'],
        run: go('/onboarding'),
      },
      {
        id: 'action:density',
        section: 'actions',
        label: `Switch density to ${DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length] ?? 'comfortable'}`,
        hint: `now ${density}`,
        icon: Layers,
        keywords: ['density', 'compact', 'comfortable', 'spacious', 'rows', 'spacing'],
        run: () => {
          close();
          setDensity(
            DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length] ?? 'comfortable',
          );
        },
      },
      {
        id: 'action:sign-out',
        section: 'actions',
        label: 'Sign out',
        icon: LogOut,
        keywords: ['log out', 'logout', 'leave'],
        run: () => {
          close();
          void signOut().then(() => {
            router.replace('/sign-in');
          });
        },
      },
    );

    // ── Organizations: switch context ─────────────────────────────────────────
    for (const org of orgs) {
      items.push({
        id: `org:${org.id}`,
        section: 'organizations',
        label: `Switch to ${org.name}`,
        icon: Building,
        keywords: [org.name, org.slug],
        org: { id: org.id, name: org.name },
        run: go(`/orgs/${org.id}/my-work`),
      });
    }

    return items;
  }, [scope, activeOrgId, orgs, orgName, router, close, density, setDensity]);
}
