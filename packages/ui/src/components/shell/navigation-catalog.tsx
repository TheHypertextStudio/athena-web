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
  Search,
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

/** One stable destination identifier shared by every shell navigation presentation. */
export type NavigationDestinationId = `home:${HomeNavKey}` | `workspace:${WorkspaceNavKey}`;

/** Display labels resolved from the active workspace vocabulary. */
export interface NavigationVocabulary {
  readonly initiatives: string;
  readonly programs: string;
  readonly projects: string;
  readonly cycles: string;
  readonly teams: string;
}

/** Inputs that determine one resolved navigation catalog. */
export interface ResolveNavigationCatalogOptions {
  readonly activeHomeKey?: HomeNavKey | undefined;
  readonly activeWorkspaceKey?: WorkspaceNavKey | undefined;
  readonly activeOrgId: string | null;
  readonly personalWorkspace: boolean;
  readonly vocabulary: NavigationVocabulary;
}

/** One display-ready destination for the expanded sidebar, rail, or More menu. */
export interface ResolvedNavigationDestination {
  readonly id: NavigationDestinationId;
  readonly key: HomeNavKey | WorkspaceNavKey;
  readonly group: 'home' | 'workspace';
  readonly moreGroup: 'workspace' | 'manage' | null;
  readonly rail: boolean;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
  readonly disabled: boolean;
}

/** The fixed set of product destinations shown in the compact navigation rail. */
export const RAIL_DESTINATION_IDS = [
  'home:today',
  'workspace:my-work',
  'home:calendar',
  'home:inbox',
  'home:search',
  'home:athena',
] as const;

interface NavigationDefinition {
  readonly id: NavigationDestinationId;
  readonly key: HomeNavKey | WorkspaceNavKey;
  readonly group: 'home' | 'workspace';
  readonly moreGroup: 'workspace' | 'manage' | null;
  readonly rail: boolean;
  readonly icon: LucideIcon;
  readonly label: (vocabulary: NavigationVocabulary) => string;
  readonly sharedWorkspaceOnly?: boolean | undefined;
}

function label(value: string): (vocabulary: NavigationVocabulary) => string {
  return () => value;
}

const DEFINITIONS: readonly NavigationDefinition[] = [
  {
    id: 'home:today',
    key: 'today',
    group: 'home',
    moreGroup: null,
    rail: true,
    icon: Home,
    label: label('Today'),
  },
  {
    id: 'home:tasks',
    key: 'tasks',
    group: 'home',
    moreGroup: 'workspace',
    rail: false,
    icon: ListChecks,
    label: label('Tasks'),
  },
  {
    id: 'home:calendar',
    key: 'calendar',
    group: 'home',
    moreGroup: null,
    rail: true,
    icon: Calendar,
    label: label('Calendar'),
  },
  {
    id: 'home:time',
    key: 'time',
    group: 'home',
    moreGroup: 'workspace',
    rail: false,
    icon: Timer,
    label: label('Time'),
  },
  {
    id: 'home:inbox',
    key: 'inbox',
    group: 'home',
    moreGroup: null,
    rail: true,
    icon: Inbox,
    label: label('Inbox'),
  },
  {
    id: 'home:athena',
    key: 'athena',
    group: 'home',
    moreGroup: null,
    rail: true,
    icon: Sparkles,
    label: label('Athena'),
  },
  {
    id: 'home:stream',
    key: 'stream',
    group: 'home',
    moreGroup: 'workspace',
    rail: false,
    icon: Activity,
    label: label('Stream'),
  },
  {
    id: 'home:portfolio',
    key: 'portfolio',
    group: 'home',
    moreGroup: 'workspace',
    rail: false,
    icon: GanttChart,
    label: label('Portfolio'),
  },
  {
    id: 'home:search',
    key: 'search',
    group: 'home',
    moreGroup: null,
    rail: true,
    icon: Search,
    label: label('Search'),
  },
  {
    id: 'workspace:my-work',
    key: 'my-work',
    group: 'workspace',
    moreGroup: null,
    rail: true,
    icon: Home,
    label: label('My Work'),
  },
  {
    id: 'workspace:triage',
    key: 'triage',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: Inbox,
    label: label('Triage'),
  },
  {
    id: 'workspace:tasks',
    key: 'tasks',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: ListChecks,
    label: label('Tasks'),
  },
  {
    id: 'workspace:stream',
    key: 'stream',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: Activity,
    label: label('Stream'),
  },
  {
    id: 'workspace:library',
    key: 'library',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: Library,
    label: label('Library'),
  },
  {
    id: 'workspace:initiatives',
    key: 'initiatives',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: Target,
    label: (vocabulary) => vocabulary.initiatives,
  },
  {
    id: 'workspace:programs',
    key: 'programs',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: Layers,
    label: (vocabulary) => vocabulary.programs,
  },
  {
    id: 'workspace:projects',
    key: 'projects',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: FolderKanban,
    label: (vocabulary) => vocabulary.projects,
  },
  {
    id: 'workspace:cycles',
    key: 'cycles',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: RefreshCw,
    label: (vocabulary) => vocabulary.cycles,
  },
  {
    id: 'workspace:teams',
    key: 'teams',
    group: 'workspace',
    moreGroup: 'workspace',
    rail: false,
    icon: Users,
    label: (vocabulary) => vocabulary.teams,
    sharedWorkspaceOnly: true,
  },
  {
    id: 'workspace:people',
    key: 'people',
    group: 'workspace',
    moreGroup: 'manage',
    rail: false,
    icon: User,
    label: label('People'),
    sharedWorkspaceOnly: true,
  },
  {
    id: 'workspace:views',
    key: 'views',
    group: 'workspace',
    moreGroup: 'manage',
    rail: false,
    icon: LayoutGrid,
    label: label('Views'),
  },
  {
    id: 'workspace:graph',
    key: 'graph',
    group: 'workspace',
    moreGroup: 'manage',
    rail: false,
    icon: Workflow,
    label: label('Graph'),
  },
  {
    id: 'workspace:settings',
    key: 'settings',
    group: 'workspace',
    moreGroup: 'manage',
    rail: false,
    icon: Settings,
    label: label('Settings'),
  },
];

/** Resolve every destination once so every navigation presentation receives the same model. */
export function resolveNavigationCatalog(
  options: ResolveNavigationCatalogOptions,
): readonly ResolvedNavigationDestination[] {
  return DEFINITIONS.filter(
    (definition) => !(options.personalWorkspace && definition.sharedWorkspaceOnly),
  ).map((definition) => ({
    id: definition.id,
    key: definition.key,
    group: definition.group,
    moreGroup: definition.moreGroup,
    rail: definition.rail,
    label: definition.label(options.vocabulary),
    icon: definition.icon,
    active:
      definition.group === 'home'
        ? options.activeHomeKey === definition.key
        : options.activeWorkspaceKey === definition.key,
    disabled: definition.group === 'workspace' && options.activeOrgId === null,
  }));
}

/** Select the daily rail in its product-owned order without changing the expanded sidebar order. */
export function selectRailDestinations(
  catalog: readonly ResolvedNavigationDestination[],
): readonly ResolvedNavigationDestination[] {
  const byId = new Map(catalog.map((destination) => [destination.id, destination] as const));
  return RAIL_DESTINATION_IDS.flatMap((id) => {
    const destination = byId.get(id);
    return destination ? [destination] : [];
  });
}
