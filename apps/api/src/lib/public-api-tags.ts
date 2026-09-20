/** Public reference navigation. Nested definitions keep membership and order in one place. */
const definitions = [
  {
    id: 'start',
    displayName: 'Start',
    tags: [
      [
        'Config',
        'Config',
        'Read the public bootstrap configuration that clients need before sign-in. These operations expose non-secret settings such as enabled authentication providers and application mode.',
      ],
      [
        'Authentication',
        'Authentication',
        'Look up registered OAuth client information used during authorization. Each operation documents its own authentication requirements; this group does not grant access to protected resources.',
      ],
    ],
  },
  {
    id: 'workspaces-and-access',
    displayName: 'Workspaces and access',
    tags: [
      [
        'Orgs',
        'Organizations (workspaces)',
        'Organizations define workspace and tenant boundaries. Create and manage personal or shared workspaces, and list the organizations available to the caller.',
      ],
      [
        'Members',
        'Members',
        'Manage workspace membership, invitations, and member roles. Membership connects a person to an organization through an actor whose permissions apply within that workspace.',
      ],
      [
        'Roles',
        'Roles',
        'Manage the roles assigned to workspace actors. Roles establish base capabilities and visibility defaults; resource grants can further shape access to individual work items.',
      ],
      [
        'Grants',
        'Grants',
        'Manage resource-level permission grants for workspace actors. Grants complement role capabilities and apply within the resource hierarchy rather than granting cross-workspace access.',
      ],
      [
        'Teams',
        'Teams',
        'Manage teams within a workspace and the people who belong to them. Teams organize work ownership and provide context for the workflow states used by tasks.',
      ],
      [
        'Statuses',
        'Statuses',
        'Manage work statuses and their assignment within workspace workflows. These operations define the states that work moves through and the rules for changing or removing those states.',
      ],
    ],
  },
  {
    id: 'work',
    displayName: 'Work',
    tags: [
      [
        'Initiatives',
        'Initiatives',
        'Manage strategic initiatives that connect projects and programs around an objective. Initiatives provide shared context, timelines, and progress information across related work.',
      ],
      [
        'Programs',
        'Programs',
        'Manage ongoing programs and the projects linked to them. Programs organize a continuing line of work and expose its relationships, visibility, and status updates.',
      ],
      [
        'Projects',
        'Projects',
        'Manage bounded projects with owners, dates, and health information. Projects organize tasks, milestones, cycles, and updates within the workspace permission model.',
      ],
      [
        'Milestones',
        'Milestones',
        'Manage dated checkpoints within a project and the tasks assigned to them. Milestones describe scope targets without becoming a separate workspace or permission boundary.',
      ],
      [
        'Cycles',
        'Cycles',
        'Manage time-boxed iterations and the work assigned to them. Cycle operations expose iteration windows, progress, and lifecycle actions for planning and completing an iteration.',
      ],
      [
        'Tasks',
        'Tasks',
        'Manage tasks, assignments, workflow state, and related work. Tasks can include subtasks, dependencies, attachments, and labels, with authorization checked for each operation.',
      ],
      [
        'Labels',
        'Labels',
        'Manage labels used to classify and filter work. Labels belong to a defined scope and provide reusable metadata without changing the permissions of the items they label.',
      ],
      [
        'Comments',
        'Comments',
        'Read and manage discussions attached to work items. Comments let collaborators contribute context without requiring the same capability as changing the underlying work.',
      ],
      [
        'Updates',
        'Updates',
        'Read and publish narrative status updates for projects, initiatives, and programs. Updates record progress and health information alongside the work they describe.',
      ],
      [
        'Templates',
        'Templates',
        'Manage reusable templates for creating work with a consistent structure. Template operations expose the saved definitions and the actions available for applying them.',
      ],
      [
        'Processes',
        'Processes',
        'Manage process definitions that describe repeatable work. These operations expose definition structure and lifecycle actions separately from the work produced from a definition.',
      ],
      [
        'Recurrence',
        'Recurrence',
        'Manage recurring work series and their occurrences. Series settings describe how work repeats, while occurrence operations handle individual instances and their lifecycle.',
      ],
      [
        'Capture',
        'Capture',
        'Capture a note as work in a workspace inbox. These operations provide an entry point for recording and triaging new work before its full planning details are known.',
      ],
    ],
  },
  {
    id: 'find-and-present',
    displayName: 'Find and present',
    tags: [
      [
        'Search',
        'Search',
        'Search the work visible to the caller within a workspace. Search results follow resource visibility rules and do not reveal work through a separate authorization path.',
      ],
      [
        'Mentions',
        'Mentions',
        'Find entities and connected resources that can be referenced in content. Mention lookup provides reference metadata while retaining the visibility rules of each source.',
      ],
      [
        'Views',
        'Views',
        'Manage saved views over work items. A view stores presentation choices such as filters, grouping, and sorting so people can return to a selected set of work.',
      ],
      [
        'Display',
        'Display',
        'Read and manage entity display settings used to present work. Display configuration changes presentation metadata without replacing the underlying entity or its permissions.',
      ],
      [
        'Activity',
        'Activity',
        'Read workspace activity recorded by work changes. Activity provides a chronological account of observations such as creation, assignment, and state transitions.',
      ],
      [
        'Stream',
        'Stream',
        'Subscribe to server-sent events for live workspace updates. Each stream documents its event format and access requirements separately from ordinary JSON response operations.',
      ],
      [
        'Publishing',
        'Publishing',
        'Manage published briefs and workspace publication addresses. Publication operations control which work is shared and manage the names or verified domains used to address it.',
      ],
      [
        'Objects',
        'Object commands',
        'Apply commands through the shared object interface. These operations act on supported work objects and preserve the authorization and validation rules of the targeted object.',
      ],
    ],
  },
  {
    id: 'personal-planning',
    displayName: 'Personal planning',
    tags: [
      [
        'Hub',
        'Hub',
        'Read personal planning views across the workspaces available to the caller. Hub operations combine visible work while retaining each item’s workspace identity and access rules.',
      ],
      [
        'Calendar',
        'Calendar',
        'Manage calendar schedules used in personal planning. Calendar configuration describes schedule context separately from the integration operations that connect external providers.',
      ],
      [
        'Scheduling',
        'Scheduling',
        'Read and manage scheduled work across a planning week. Scheduling operations connect work to planned time while keeping the source work and calendar context identifiable.',
      ],
      [
        'Agenda',
        'Agenda',
        'Read a combined agenda for personal planning. Agenda operations bring scheduled information into one response while preserving the identity and context of each source item.',
      ],
      [
        'Directive',
        'Directive',
        'Manage planning directives and the actions they govern within a schedule week. Directives express planning intent separately from the tasks and time allocations they affect.',
      ],
      [
        'DailyPlan',
        'Daily plan',
        'Manage the work selected for a person’s daily plan. This person-owned planning list can reference work across workspaces without replacing the source task lists.',
      ],
      [
        'Time',
        'Time',
        'Manage tracked time, the active tracker, and Time Ledger records. Time operations expose recorded work intervals and the actions available for maintaining those records.',
      ],
      [
        'Work location',
        'Work locations',
        'Resolve current and expected work locations and manage location planning. These operations describe where a person plans to work over individual times or bounded ranges.',
      ],
    ],
  },
  {
    id: 'athena-and-agents',
    displayName: 'Athena and agents',
    tags: [
      [
        'Athena',
        'Athena',
        'Manage the person’s private Athena conversations, activity, approvals, and voice interactions. Personal assistant operations resolve workspace permissions when work is invoked.',
      ],
      [
        'Agents',
        'Agents',
        'Manage registered workspace agents and their work sessions. Agents act through workspace identities and explicit permissions, with review controls for proposed mutations.',
      ],
      [
        'Automations',
        'Automations',
        'Manage workspace automation rules that respond to observations. Rules identify triggering events, matching conditions, and actions that the automation engine can perform.',
      ],
      [
        'Suggestions',
        'Suggestions',
        'Review proposed work derived from connected sources. Suggestion operations let a person accept or dismiss a proposal before it becomes a change to workspace work.',
      ],
    ],
  },
  {
    id: 'connections',
    displayName: 'Connections',
    tags: [
      [
        'Integrations',
        'Integrations',
        'Manage connections to external services and synchronization with workspace work. Provider webhook ingestion uses separate endpoints outside this public REST reference.',
      ],
    ],
  },
  {
    id: 'account',
    displayName: 'Account',
    tags: [
      [
        'Me',
        'Me',
        'Manage the current person’s profile, account lifecycle, identities, contact points, and phone settings. Sensitive account operations document any additional verification they require.',
      ],
      [
        'Notifications',
        'Notifications',
        'Read and act on personal notifications and manage notification preferences. This group covers the recipient’s inbox and settings, not internal staff notification-intent operations.',
      ],
      [
        'Billing',
        'Billing',
        'Read workspace subscription information and manage billing through the supported checkout and portal operations. Provider payment webhooks use a separate signed ingestion endpoint.',
      ],
    ],
  },
] as const satisfies readonly {
  id: string;
  displayName: string;
  tags: readonly (readonly [id: string, displayName: string, description: string])[];
}[];

/** Stable OpenAPI tag names, distinct from their human-readable display labels. */
export type PublicTagId = (typeof definitions)[number]['tags'][number][0];

/** Stable reference-navigation group identifiers. */
export type PublicTagGroupId = (typeof definitions)[number]['id'];

/** Metadata for one tag in the public reference, not an authentication classification. */
export interface PublicTag {
  readonly id: PublicTagId;
  readonly displayName: string;
  readonly description: string;
  readonly audience: 'public';
  readonly order: number;
  readonly group: PublicTagGroupId;
}

/** An ordered navigation group whose tag names remain stable in the OpenAPI contract. */
export interface PublicTagGroup {
  readonly id: PublicTagGroupId;
  readonly displayName: string;
  readonly order: number;
  readonly tags: readonly PublicTagId[];
}

/** The eight public reference groups in sidebar order. */
export const PUBLIC_TAG_GROUPS: readonly PublicTagGroup[] = definitions.map((group, order) => ({
  id: group.id,
  displayName: group.displayName,
  order,
  tags: group.tags.map(([id]) => id),
}));

/** Public tag metadata in sidebar order, with a global zero-based ordering index. */
export const PUBLIC_TAGS: readonly PublicTag[] = definitions
  .flatMap((group) =>
    group.tags.map(([id, displayName, description]) => ({
      id,
      displayName,
      description,
      audience: 'public' as const,
      group: group.id,
    })),
  )
  .map((tag, order) => ({ ...tag, order }));

/** The complete typed lookup for public tags; derived rather than separately maintained. */
export const PUBLIC_TAG_REGISTRY = Object.fromEntries(
  PUBLIC_TAGS.map((tag) => [tag.id, tag]),
) as Readonly<Record<PublicTagId, PublicTag>>;

/** Legacy route tags that now belong to a consolidated public reference section. */
export const PUBLIC_TAG_CONSOLIDATIONS = {
  Organizations: 'Orgs',
  'Me Notifications': 'Notifications',
  'Me Notification Preferences': 'Notifications',
  'Me Contact Points': 'Me',
  'Me Phone': 'Me',
  'Athena Voice': 'Athena',
  OAuth: 'Authentication',
} as const satisfies Readonly<Record<string, PublicTagId>>;

/** Legacy tag names accepted only for migration and deep-link compatibility. */
export type LegacyPublicTagId = keyof typeof PUBLIC_TAG_CONSOLIDATIONS;

/** Resolve a current or legacy public tag without accepting staff tags or object prototype keys. */
export function resolvePublicTagId(value: string): PublicTagId | undefined {
  if (Object.hasOwn(PUBLIC_TAG_REGISTRY, value)) return value as PublicTagId;
  if (Object.hasOwn(PUBLIC_TAG_CONSOLIDATIONS, value)) {
    return PUBLIC_TAG_CONSOLIDATIONS[value as LegacyPublicTagId];
  }
  return undefined;
}
