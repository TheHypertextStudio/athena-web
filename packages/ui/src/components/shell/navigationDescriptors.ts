import {
  Activity,
  Calendar,
  FolderKanban,
  GanttChart,
  Home,
  Inbox,
  Layers,
  LayoutGrid,
  Library,
  ListChecks,
  RefreshCw,
  Settings,
  Sparkles,
  Target,
  Timer,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from '../../icons';
import type { HomeNavKey, WorkspaceNavKey } from './workspaces';

/** A vocabulary key whose displayed label depends on the current workspace. */
export type NavigationVocabularyKey = 'initiative' | 'program' | 'project' | 'cycle' | 'team';

/** Shared semantic metadata for one Home navigation destination. */
export interface HomeNavigationDescriptor {
  readonly key: Exclude<HomeNavKey, 'search'>;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly icon: LucideIcon;
  readonly href: string;
}

/** Shared semantic metadata for one workspace navigation destination. */
export interface WorkspaceNavigationDescriptor {
  readonly key: WorkspaceNavKey;
  readonly label: string | { readonly vocabulary: NavigationVocabularyKey };
  readonly description: string;
  readonly aliases: readonly string[];
  readonly icon: LucideIcon;
  readonly segment: string;
  readonly sharedOnly?: boolean;
}

/** Cross-workspace destinations rendered by both the Sidebar and capability catalog. */
export const HOME_NAVIGATION_DESCRIPTORS: readonly HomeNavigationDescriptor[] = [
  {
    key: 'today',
    label: 'Today',
    description: 'Plan the day and see work that needs your attention.',
    aliases: ['home', 'daily plan'],
    icon: Home,
    href: '/today',
  },
  {
    key: 'tasks',
    label: 'Tasks',
    description: 'See tasks assigned to you across every workspace.',
    aliases: ['my tasks', 'work'],
    icon: ListChecks,
    href: '/tasks',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    description: 'See events and scheduled work across connected calendars.',
    aliases: ['schedule', 'events'],
    icon: Calendar,
    href: '/calendar',
  },
  {
    key: 'time',
    label: 'Time',
    description: 'Review focus sessions and time spent on work.',
    aliases: ['timer', 'focus history'],
    icon: Timer,
    href: '/time',
  },
  {
    key: 'inbox',
    label: 'Inbox',
    description: 'Review notifications, approvals, and work that needs a decision.',
    aliases: ['notifications', 'approvals'],
    icon: Inbox,
    href: '/inbox',
  },
  {
    key: 'athena',
    label: 'Athena',
    description: 'Open the full conversation with your chief of staff.',
    aliases: ['assistant', 'chat'],
    icon: Sparkles,
    href: '/athena',
  },
  {
    key: 'stream',
    label: 'Stream',
    description: 'See activity from Docket and connected services.',
    aliases: ['activity', 'updates'],
    icon: Activity,
    href: '/stream',
  },
  {
    key: 'portfolio',
    label: 'Portfolio',
    description: 'See projects and programs across every workspace on one timeline.',
    aliases: ['roadmap', 'timeline'],
    icon: GanttChart,
    href: '/portfolio',
  },
];

/** Current-workspace destinations rendered by both the Sidebar and capability catalog. */
export const WORKSPACE_NAVIGATION_DESCRIPTORS: readonly WorkspaceNavigationDescriptor[] = [
  {
    key: 'my-work',
    label: 'My Work',
    description: 'See work assigned to you and work delegated to agents in this workspace.',
    aliases: ['assigned', 'delegated'],
    icon: Home,
    segment: 'my-work',
  },
  {
    key: 'triage',
    label: 'Triage',
    description: 'Review unsorted work and suggestions in this workspace.',
    aliases: ['unsorted', 'workspace inbox'],
    icon: Inbox,
    segment: 'triage',
  },
  {
    key: 'tasks',
    label: 'Tasks',
    description: 'Browse every task in this workspace.',
    aliases: ['issues', 'work items'],
    icon: ListChecks,
    segment: 'tasks',
  },
  {
    key: 'stream',
    label: 'Stream',
    description: 'See activity for this workspace.',
    aliases: ['activity', 'updates'],
    icon: Activity,
    segment: 'stream',
  },
  {
    key: 'library',
    label: 'Library',
    description: 'Find documents, files, links, and connected resources for this workspace.',
    aliases: ['documents', 'files', 'resources'],
    icon: Library,
    segment: 'library',
  },
  {
    key: 'initiatives',
    label: { vocabulary: 'initiative' },
    description: 'Browse the strategic outcomes this workspace is pursuing.',
    aliases: ['initiatives', 'goals', 'themes'],
    icon: Target,
    segment: 'initiatives',
  },
  {
    key: 'programs',
    label: { vocabulary: 'program' },
    description: 'Browse ongoing areas of work in this workspace.',
    aliases: ['programs', 'streams'],
    icon: Layers,
    segment: 'programs',
  },
  {
    key: 'projects',
    label: { vocabulary: 'project' },
    description: 'Browse bounded projects in this workspace.',
    aliases: ['projects'],
    icon: FolderKanban,
    segment: 'projects',
  },
  {
    key: 'cycles',
    label: { vocabulary: 'cycle' },
    description: 'Browse planning cycles for this workspace.',
    aliases: ['cycles', 'sprints'],
    icon: RefreshCw,
    segment: 'cycles',
  },
  {
    key: 'teams',
    label: { vocabulary: 'team' },
    description: 'Browse teams in this workspace.',
    aliases: ['teams', 'groups'],
    icon: Users,
    segment: 'teams',
    sharedOnly: true,
  },
  {
    key: 'people',
    label: 'People',
    description: 'Browse the people this workspace works with.',
    aliases: ['members', 'contacts'],
    icon: User,
    segment: 'people',
    sharedOnly: true,
  },
  {
    key: 'views',
    label: 'Views',
    description: 'Open saved views for this workspace.',
    aliases: ['saved views', 'filters'],
    icon: LayoutGrid,
    segment: 'views',
  },
  {
    key: 'graph',
    label: 'Graph',
    description: 'Explore relationships between work in this workspace.',
    aliases: ['canvas', 'relationships'],
    icon: Workflow,
    segment: 'graph',
  },
  {
    key: 'settings',
    label: 'Settings',
    description: 'Configure this workspace.',
    aliases: ['preferences', 'administration'],
    icon: Settings,
    segment: 'settings/general',
  },
];
