import type { AppCapability } from '@/components/app-catalog';

import {
  PERSONAL_SETTINGS_SECTIONS,
  SETTINGS_SECTIONS,
  personalSectionHref,
  sectionHref,
} from './settings-registry';

/** A stable discoverable heading within one routed Settings section. */
export interface SettingsNodeDefinition {
  /** Stable catalog identifier and route fragment without the `settings:` prefix. */
  readonly id: string;
  /** Heading text rendered on the Settings surface. */
  readonly label: string;
  /** Searchable plain-language description rendered under the heading. */
  readonly description: string;
  /** Extra terms people use for the setting. */
  readonly aliases?: readonly string[];
  /** Registry key for the routed Settings section that owns the heading. */
  readonly sectionKey: string;
  /** Whether the owning Settings section is personal or workspace-scoped. */
  readonly scope: 'personal' | 'workspace';
  /** Nested path below the personal or workspace Settings root, when not on the section route. */
  readonly nestedPath?: string;
}

const personalNode = (
  id: string,
  sectionKey: string,
  label: string,
  description: string,
  aliases?: readonly string[],
): SettingsNodeDefinition => ({
  id,
  sectionKey,
  label,
  description,
  scope: 'personal',
  ...(aliases ? { aliases } : {}),
});

const workspaceNode = (
  id: string,
  sectionKey: string,
  label: string,
  description: string,
  aliases?: readonly string[],
): SettingsNodeDefinition => ({
  id,
  sectionKey,
  label,
  description,
  scope: 'workspace',
  ...(aliases ? { aliases } : {}),
});

/** Every stable Settings group and subsection that Cmd+K can open directly. */
export const SETTINGS_NODES = {
  profileIdentity: personalNode(
    'profile-identity',
    'profile',
    'Your identity',
    'The name and identity Athena uses across connected services.',
  ),
  profileEmail: personalNode(
    'profile-email',
    'profile',
    'Email address',
    'Change the email address used to sign in and receive account messages.',
  ),
  athenaWorkingPreferences: personalNode(
    'athena-working-preferences',
    'athena',
    'Working preferences',
    'Give Athena durable guidance for how to represent you.',
  ),
  athenaPhone: personalNode(
    'athena-phone',
    'athena',
    'Call Athena',
    'Choose the phone numbers that can call Athena.',
    ['voice', 'phone'],
  ),
  athenaLattice: personalNode(
    'athena-lattice',
    'athena',
    'Run models on your own computer',
    'Connect a computer you own so Athena can run its models there instead of in the cloud.',
    ['lattice', 'local'],
  ),
  connectionsTools: personalNode(
    'connections-tools',
    'connections',
    'Tools & apps for Athena',
    'Connect services Athena can use and show as interactive apps.',
  ),
  connectionsEmailTasks: personalNode(
    'connections-email-tasks',
    'connections',
    'Email to tasks',
    'Let Athena read new mail and suggest tasks in your inbox.',
    ['mail ingest'],
  ),
  connectionsGoogleTasks: personalNode(
    'connections-google-tasks',
    'connections',
    'Google Tasks',
    'Connect Google Tasks accounts to Docket.',
  ),
  connectionsCalendar: personalNode(
    'connections-calendar',
    'connections',
    'Calendar',
    'Connect calendar accounts to Docket.',
    ['Google Calendar'],
  ),
  connectionsAgents: personalNode(
    'connections-agents',
    'connections',
    'Agents',
    'Install and manage agents connected to Docket.',
  ),
  connectionsDocketCalendars: {
    ...personalNode(
      'connections-docket-calendars',
      'connections',
      'Docket calendars',
      'Choose which Docket calendars sync to a connected Google account.',
      ['Google Calendar'],
    ),
    nestedPath: 'connections/google-calendar',
  },
  connectionsNotionSetup: {
    ...workspaceNode(
      'connections-notion-setup',
      'connections',
      'Set up Docket in Notion',
      'Pick a page in your Notion workspace. Docket builds its databases inside it and keeps them current. You can move them anywhere in Notion afterwards — Docket keeps up. Nothing is created until you press Create.',
      ['Notion setup'],
    ),
    nestedPath: 'connections/notion',
  },
  connectionsNotionDatabases: {
    ...workspaceNode(
      'connections-notion-databases',
      'connections',
      'Tables Docket builds for you',
      'Each of these is a Notion database Docket fills in and keeps current. Configure one to change its name or which columns it has.',
      ['Notion sync'],
    ),
    nestedPath: 'connections/notion',
  },
  connectionsNotionMappings: {
    ...workspaceNode(
      'connections-notion-mappings',
      'connections',
      'Review linked Notion mappings',
      'Review the Notion properties that Docket mapped automatically before they sync.',
      ['Notion sync', 'field mappings'],
    ),
    nestedPath: 'connections/notion',
  },
  connectedAppsClient: personalNode(
    'connected-apps-client',
    'connected-apps',
    'Connect an MCP client',
    'Give an MCP-compatible tool access to your Docket account.',
    ['Claude Desktop', 'Cursor'],
  ),
  connectedAppsAccess: personalNode(
    'connected-apps-access',
    'connected-apps',
    'Apps with access to your Docket',
    'These apps use the permissions you approved. Revoking takes effect immediately.',
  ),
  notificationsQuietHours: personalNode(
    'notifications-quiet-hours',
    'notifications',
    'Quiet hours',
    'Hold non-urgent notifications during chosen hours.',
    ['do not disturb'],
  ),
  notificationsAdvancedRules: personalNode(
    'notifications-advanced-rules',
    'notifications',
    'Advanced channel rules',
    'Choose which notification channels each event can use.',
  ),
  calendarNewItems: personalNode(
    'calendar-new-items',
    'calendar',
    'New calendar items',
    'Choose what dragging across the calendar creates.',
  ),
  calendarDisplay: personalNode(
    'calendar-display',
    'calendar',
    'Display',
    'Choose how calendar content appears.',
  ),
  calendarVisibility: personalNode(
    'calendar-visibility',
    'calendar',
    'What coworkers can see',
    'Choose which calendar details coworkers can see.',
    ['privacy', 'busy'],
  ),
  workLocationsPlaces: personalNode(
    'work-locations-places',
    'work-locations',
    'Saved places',
    'Manage the places where you work.',
  ),
  workLocationsSchedule: personalNode(
    'work-locations-schedule',
    'work-locations',
    'Schedule',
    'Set the places where you usually work each day.',
  ),
  workLocationsPlanned: personalNode(
    'work-locations-planned',
    'work-locations',
    'Planned work',
    'Review work that has an explicit planned location.',
  ),
  workLocationsAutomatic: personalNode(
    'work-locations-automatic',
    'work-locations',
    'Automatic location',
    'Control how Docket determines your current work location.',
  ),
  workLocationsCalendarSync: personalNode(
    'work-locations-calendar-sync',
    'work-locations',
    'Calendar sync',
    'Publish Google work locations as calendar events.',
  ),
  securitySessions: personalNode(
    'security-sessions',
    'security',
    'Active sessions',
    'Review and revoke devices signed in to your account.',
    ['devices', 'sign out'],
  ),
  securityPasskeys: personalNode(
    'passkeys',
    'security',
    'Passkeys',
    'Manage Face ID, Touch ID, and security keys used to sign in.',
    ['webauthn', 'security key'],
  ),
  securityRecoveryCodes: personalNode(
    'security-recovery-codes',
    'security',
    'Recovery codes',
    'Create and store one-time codes that restore account access.',
    ['backup codes'],
  ),
  dataExportSelection: personalNode(
    'data-export-selection',
    'data-privacy',
    'Choose data to include',
    'Select which Docket data to include in an export.',
  ),
  dataExportReview: personalNode(
    'data-export-review',
    'data-privacy',
    'Review & create',
    'Review and create a Docket data export.',
  ),
  dataExportHistory: personalNode(
    'data-export-history',
    'data-privacy',
    'Recent exports',
    'Review recent Docket data exports and their status.',
  ),
  dataDeleteBlockers: personalNode(
    'data-delete-blockers',
    'data-privacy',
    'Resolve these workspaces first',
    'Review workspaces that block account deletion.',
  ),
  workspaceGeneral: workspaceNode(
    'workspace-general',
    'general',
    'Workspace',
    'Edit the workspace name, purpose, address, logo, and terms.',
  ),
  workspaceInvite: workspaceNode(
    'workspace-invite',
    'members',
    'Invite someone',
    'Invite a person to join this workspace.',
  ),
  workspacePendingInvites: workspaceNode(
    'workspace-pending-invites',
    'members',
    'Pending invitations',
    'Review invitations that have not been accepted.',
  ),
  workspaceAutomationsRules: workspaceNode(
    'workspace-automation-rules',
    'automations',
    'Rules',
    'Manage rules that watch for events and take actions.',
  ),
  publishingAddresses: workspaceNode(
    'publishing-addresses',
    'publishing',
    'Addresses',
    'Manage web addresses for published workspace pages.',
    ['domains'],
  ),
  publishingPages: workspaceNode(
    'publishing-pages',
    'publishing',
    'Published pages',
    'Review pages this workspace publishes to the web.',
  ),
} as const satisfies Record<string, SettingsNodeDefinition>;

const personal: readonly AppCapability[] = PERSONAL_SETTINGS_SECTIONS.map((section) => ({
  id: `settings:personal:${section.key}`,
  label: section.label,
  description: section.description,
  aliases: ['settings', 'preferences', section.key],
  icon: section.icon,
  breadcrumb: ['Settings', 'Personal'],
  scope: 'global',
  requiresQuery: true,
  target: { type: 'route', href: personalSectionHref(section.href) },
}));

const workspace: readonly AppCapability[] = SETTINGS_SECTIONS.map((section) => ({
  id: `settings:workspace:${section.key}`,
  label: section.label,
  description: section.description,
  aliases: ['settings', 'preferences', section.key],
  icon: section.icon,
  breadcrumb: ['Settings', 'Workspace'],
  scope: 'workspace',
  requiresQuery: true,
  target: {
    type: 'route',
    href: (context) => (context.activeOrgId ? sectionHref(context.activeOrgId, section.href) : ''),
  },
  available: (context) =>
    context.activeOrgId !== null &&
    (!section.sharedOnly || !context.activeOrgIsPersonal) &&
    (!section.requiresManage || context.canManageActiveOrg),
}));

const connectionsIcon = PERSONAL_SETTINGS_SECTIONS.find(
  (section) => section.key === 'connections',
)?.icon;
if (!connectionsIcon) throw new Error('The Settings registry must define Connections.');

/** Stable nested Settings destinations that have their own routed page. */
export const NESTED_SETTINGS_CAPABILITIES: readonly AppCapability[] = [
  {
    id: 'settings:personal:connections:google-calendar',
    label: 'Google Calendar',
    description: 'Connect Google Calendar and choose which calendars Docket can use.',
    aliases: ['calendar account', 'calendar connection'],
    icon: connectionsIcon,
    breadcrumb: ['Settings', 'Connections'],
    scope: 'global',
    requiresQuery: true,
    target: { type: 'route', href: '/settings/connections/google-calendar' },
  },
  {
    id: 'settings:workspace:connections:google-calendar',
    label: 'Google Calendar',
    description: 'Connect Google Calendar to the current workspace.',
    aliases: ['calendar account', 'calendar connection'],
    icon: connectionsIcon,
    breadcrumb: ['Settings', 'Connections'],
    scope: 'workspace',
    requiresQuery: true,
    target: {
      type: 'route',
      href: (context) =>
        context.activeOrgId
          ? `/orgs/${context.activeOrgId}/settings/connections/google-calendar`
          : '',
    },
    available: (context) => context.activeOrgId !== null && !context.activeOrgIsPersonal,
  },
  {
    id: 'settings:workspace:connections:notion',
    label: 'Notion',
    description: 'Connect and synchronize Notion databases with the current workspace.',
    aliases: ['Notion mirror', 'Notion databases'],
    icon: connectionsIcon,
    breadcrumb: ['Settings', 'Connections'],
    scope: 'workspace',
    requiresQuery: true,
    target: {
      type: 'route',
      href: (context) =>
        context.activeOrgId ? `/orgs/${context.activeOrgId}/settings/connections/notion` : '',
    },
    available: (context) => context.activeOrgId !== null && !context.activeOrgIsPersonal,
  },
  {
    id: 'settings:workspace:connections:notion-people',
    label: 'Notion people',
    description: 'Match people from Notion to members of the current workspace.',
    aliases: ['Notion users', 'person mapping'],
    icon: connectionsIcon,
    breadcrumb: ['Settings', 'Connections', 'Notion'],
    scope: 'workspace',
    requiresQuery: true,
    target: {
      type: 'route',
      href: (context) =>
        context.activeOrgId
          ? `/orgs/${context.activeOrgId}/settings/connections/notion/people`
          : '',
    },
    available: (context) => context.activeOrgId !== null && !context.activeOrgIsPersonal,
  },
];

const nodeCapabilities: readonly AppCapability[] = Object.values(SETTINGS_NODES).map((node) => {
  const section =
    node.scope === 'personal'
      ? PERSONAL_SETTINGS_SECTIONS.find((candidate) => candidate.key === node.sectionKey)
      : SETTINGS_SECTIONS.find((candidate) => candidate.key === node.sectionKey);
  if (!section) throw new Error(`Unknown Settings section for ${node.id}: ${node.sectionKey}`);
  const fragment = `settings-${node.id}`;
  return {
    id: `settings:node:${node.id}`,
    label: node.label,
    description: node.description,
    aliases: ['settings', ...(node.aliases ?? [])],
    icon: section.icon,
    breadcrumb: ['Settings', section.label],
    scope: node.scope === 'personal' ? 'global' : 'workspace',
    requiresQuery: true,
    target: {
      type: 'route',
      href: (context) => {
        const base =
          node.scope === 'personal'
            ? `/settings/${node.nestedPath ?? section.href}`
            : context.activeOrgId
              ? `/orgs/${context.activeOrgId}/settings/${node.nestedPath ?? section.href}`
              : '';
        return `${base}#${fragment}`;
      },
    },
    available: (context) =>
      node.scope === 'personal' ||
      (context.activeOrgId !== null &&
        (!section.sharedOnly || !context.activeOrgIsPersonal) &&
        (!section.requiresManage || context.canManageActiveOrg)),
  };
});

/** Every routed Settings section, resolved against the current shell workspace. */
export const SETTINGS_CAPABILITIES: readonly AppCapability[] = [
  ...personal,
  ...workspace,
  ...NESTED_SETTINGS_CAPABILITIES,
  ...nodeCapabilities,
];
