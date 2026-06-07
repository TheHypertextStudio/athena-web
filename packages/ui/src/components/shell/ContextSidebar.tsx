'use client';

/**
 * `@docket/ui` — the org-scoped navigation sidebar.
 *
 * @remarks
 * Renders the standard org nav (My Work, Triage, Initiatives, Programs, Projects, Cycles,
 * Teams, Views, Agents, Settings). Entity-noun rows (Initiatives, Programs, Projects,
 * Cycles, Teams) resolve their labels through `useVocabulary` so they honor the active org's
 * vocabulary skin — an agency sees "Engagements", "Retainers", "Sprints", and "Pods" where a
 * startup sees "Initiatives", "Programs", "Cycles", and "Teams". Non-entity rows use fixed
 * labels. Selecting a row reports its key via `onNavigate`; routing is owned by the host app.
 */
import * as React from 'react';

import {
  FolderKanban,
  Home,
  Inbox,
  Layers,
  LayoutGrid,
  type LucideIcon,
  RefreshCw,
  Settings,
  Sparkles,
  Target,
  Users,
} from '../../icons';
import { useVocabulary } from '../../hooks/useVocabulary';
import { SidebarNavItem } from './SidebarNavItem';

/** The stable identifier for a {@link ContextSidebar} nav destination. */
export type SidebarNavKey =
  | 'my-work'
  | 'triage'
  | 'initiatives'
  | 'programs'
  | 'projects'
  | 'cycles'
  | 'teams'
  | 'views'
  | 'agents'
  | 'settings';

/** Props for {@link ContextSidebar}. */
export interface ContextSidebarProps {
  /** The currently-active nav key (highlighted row). */
  activeKey?: SidebarNavKey;
  /** Invoked with the selected nav key when a row is chosen. */
  onNavigate?: (key: SidebarNavKey) => void;
}

/** A resolved nav row descriptor. */
interface NavRow {
  /** Stable destination key. */
  key: SidebarNavKey;
  /** Display-ready, vocabulary-resolved label. */
  label: string;
  /** Leading icon. */
  icon: LucideIcon;
}

/**
 * The org-scoped navigation sidebar.
 *
 * @remarks
 * Must be rendered inside a `VocabularyProvider` so entity-noun rows resolve to the active
 * org's vocabulary; outside one (or on the Hub) labels fall back to the startup preset.
 */
export function ContextSidebar({ activeKey, onNavigate }: ContextSidebarProps): React.JSX.Element {
  const initiatives = useVocabulary('initiative', { plural: true });
  const programs = useVocabulary('program', { plural: true });
  const projects = useVocabulary('project', { plural: true });
  const cycles = useVocabulary('cycle', { plural: true });
  const teams = useVocabulary('team', { plural: true });

  const rows: readonly NavRow[] = [
    { key: 'my-work', label: 'My Work', icon: Home },
    { key: 'triage', label: 'Triage', icon: Inbox },
    { key: 'initiatives', label: initiatives, icon: Target },
    { key: 'programs', label: programs, icon: Layers },
    { key: 'projects', label: projects, icon: FolderKanban },
    { key: 'cycles', label: cycles, icon: RefreshCw },
    { key: 'teams', label: teams, icon: Users },
    { key: 'views', label: 'Views', icon: LayoutGrid },
    { key: 'agents', label: 'Agents', icon: Sparkles },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside
      aria-label="Navigation"
      className="border-border bg-card flex h-full w-60 shrink-0 flex-col gap-1 border-r p-2"
    >
      <nav className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <SidebarNavItem
            key={row.key}
            label={row.label}
            icon={row.icon}
            active={activeKey === row.key}
            onSelect={
              onNavigate
                ? () => {
                    onNavigate(row.key);
                  }
                : undefined
            }
          />
        ))}
      </nav>
    </aside>
  );
}
