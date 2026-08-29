import type { ViewTarget } from '@docket/work/view-contract';

/**
 * Return the collection key that owns one work target.
 *
 * @param orgId - The workspace used to read the collection.
 * @param target - The work entity whose collection owns the query.
 * @returns The target's workspace-scoped collection prefix.
 */
export function workTargetCollectionKey(
  orgId: string,
  target: ViewTarget,
): readonly ['org', string, 'tasks' | 'projects' | 'programs' | 'initiatives'] {
  switch (target) {
    case 'task':
      return ['org', orgId, 'tasks'];
    case 'project':
      return ['org', orgId, 'projects'];
    case 'program':
      return ['org', orgId, 'programs'];
    case 'initiative':
      return ['org', orgId, 'initiatives'];
  }
}

/**
 * Org-scoped, hierarchical TanStack Query key convention.
 *
 * @remarks
 * Every key is a tuple beginning with the org id (or `'me'` for cross-org scope),
 * then the entity collection, then — for detail keys — the entity id. Invalidating a
 * coarse key (e.g. `queryKeys.projects(orgId)`) also invalidates every finer key under
 * it by prefix match.
 */
export const queryKeys = {
  projects: (orgId: string) => ['org', orgId, 'projects'] as const,
  project: (orgId: string, projectId: string) => ['org', orgId, 'projects', projectId] as const,
  // The entity's own row, separate from the composite detail read above it.
  //
  // A detail page needs two different things: its masthead (icon, name, summary, properties) is
  // one row, while its tab panels need the dozen-request composite. Keeping them apart is what
  // lets the identity paint immediately — seeded straight from a create response, restored from a
  // list, or fetched as a single cheap read — instead of waiting on the whole composite. Nested
  // under the detail key so any coarse invalidation still reaches it.
  projectRecord: (orgId: string, projectId: string) =>
    ['org', orgId, 'projects', projectId, 'record'] as const,
  projectAggregate: (orgId: string, projectId: string) =>
    ['org', orgId, 'projects', projectId, 'aggregate-detail'] as const,
  tasks: (orgId: string) => ['org', orgId, 'tasks'] as const,
  task: (orgId: string, taskId: string) => ['org', orgId, 'tasks', taskId] as const,
  taskAggregate: (orgId: string, taskId: string) =>
    ['org', orgId, 'tasks', taskId, 'aggregate-detail'] as const,
  // Nested under the task's own detail key on purpose: every task mutation already invalidates
  // `queryKeys.task(...)`, and prefix matching carries that through to the history, so editing a
  // property re-reads the entry it just wrote without any call site knowing the log exists.
  taskActivity: (orgId: string, taskId: string) =>
    ['org', orgId, 'tasks', taskId, 'activity'] as const,
  processDefinitions: (orgId: string) => ['org', orgId, 'process-definitions'] as const,
  processDefinition: (orgId: string, definitionId: string) =>
    ['org', orgId, 'process-definitions', definitionId] as const,
  recurrenceSeries: (orgId: string) => ['org', orgId, 'recurrence-series'] as const,
  recurrenceSeriesDetail: (orgId: string, seriesId: string) =>
    ['org', orgId, 'recurrence-series', seriesId] as const,
  // Publishing keys nest under one `publishing` segment so a publish/withdraw can invalidate the
  // whole area (a brief's reachable URLs depend on the workspace's domains) with a single coarse
  // prefix, while a detail read still has its own targeted key.
  publications: (orgId: string) => ['org', orgId, 'publishing', 'publications'] as const,
  publication: (orgId: string, subjectKind: string, subjectId: string) =>
    ['org', orgId, 'publishing', 'publications', subjectKind, subjectId] as const,
  workspaceDomains: (orgId: string) => ['org', orgId, 'publishing', 'domains'] as const,
  programs: (orgId: string) => ['org', orgId, 'programs'] as const,
  program: (orgId: string, programId: string) => ['org', orgId, 'programs', programId] as const,
  /** The program's own row — see {@link queryKeys.projectRecord} for why this is separate. */
  programRecord: (orgId: string, programId: string) =>
    ['org', orgId, 'programs', programId, 'record'] as const,
  programAggregate: (orgId: string, programId: string) =>
    ['org', orgId, 'programs', programId, 'aggregate-detail'] as const,
  initiatives: (orgId: string) => ['org', orgId, 'initiatives'] as const,
  initiativeHierarchyCandidates: (orgId: string, mode: 'parent' | 'child', query: string) =>
    ['org', orgId, 'initiatives', 'hierarchy-candidates', mode, query] as const,
  initiative: (orgId: string, initiativeId: string) =>
    ['org', orgId, 'initiatives', initiativeId] as const,
  /** The initiative's own row — see {@link queryKeys.projectRecord} for why this is separate. */
  initiativeRecord: (orgId: string, initiativeId: string) =>
    ['org', orgId, 'initiatives', initiativeId, 'record'] as const,
  initiativeAggregate: (orgId: string, initiativeId: string) =>
    ['org', orgId, 'initiatives', initiativeId, 'aggregate-detail'] as const,
  cycles: (orgId: string) => ['org', orgId, 'cycles'] as const,
  cycle: (orgId: string, cycleId: string) => ['org', orgId, 'cycles', cycleId] as const,
  teams: (orgId: string) => ['org', orgId, 'teams'] as const,
  team: (orgId: string, teamId: string) => ['org', orgId, 'teams', teamId] as const,
  teamRosters: (orgId: string) => ['org', orgId, 'teams', 'rosters'] as const,
  teamMembers: (orgId: string, teamId: string) =>
    ['org', orgId, 'teams', teamId, 'members'] as const,
  teamActivity: (orgId: string, teamId: string) =>
    ['org', orgId, 'teams', teamId, 'activity'] as const,
  // Keyed by subject type: the hub reads one type in bulk and each detail page reads one subject,
  // so the two never share a cache entry and invalidating a type does not disturb the others.
  entityDisplays: (orgId: string, subjectType: string) =>
    ['org', orgId, 'display', subjectType] as const,
  entityDisplay: (orgId: string, subjectType: string, subjectId: string) =>
    ['org', orgId, 'display', subjectType, subjectId] as const,
  milestones: (orgId: string) => ['org', orgId, 'milestones'] as const,
  members: (orgId: string) => ['org', orgId, 'members'] as const,
  roles: (orgId: string) => ['org', orgId, 'roles'] as const,
  invitations: (orgId: string) => ['org', orgId, 'invitations'] as const,
  integrations: (orgId: string) => ['org', orgId, 'integrations'] as const,
  integrationLists: (orgId: string, integrationId: string) =>
    ['org', orgId, 'integrations', integrationId, 'lists'] as const,
  integrationsDirectory: (orgId: string) => ['org', orgId, 'integrations-directory'] as const,
  /**
   * One integration's recent sync runs.
   *
   * @remarks
   * The durable per-run history, which is the only place a *purpose*-specific outcome survives.
   * The integration's own roll-up (`status`, `lastSyncedAt`) is written by whichever purpose ran
   * last, so a surface that owns one purpose has to read the runs to know how its own is doing.
   */
  integrationRuns: (orgId: string, integrationId: string) =>
    ['org', orgId, 'integrations', integrationId, 'runs'] as const,
  /** The Docket-designed Notion databases for one integration. */
  notionMirrorDatabases: (orgId: string, integrationId: string) =>
    ['org', orgId, 'integrations', integrationId, 'notion', 'databases'] as const,
  /** One entity's table design plus its preview rows. */
  notionMirrorDesign: (orgId: string, integrationId: string, entity: string) =>
    ['org', orgId, 'integrations', integrationId, 'notion', 'design', entity] as const,
  /** Notion workspace members and their Docket actor matches. */
  notionMirrorPeople: (orgId: string, integrationId: string) =>
    ['org', orgId, 'integrations', integrationId, 'notion', 'people'] as const,
  /**
   * One page of the Notion parent-page search.
   *
   * @remarks
   * The settled search term is part of the key, not a parameter the fetcher closes over: that is
   * what hands deduplication, cancellation and race-safety to TanStack instead of re-solving them
   * by hand for every keystroke.
   */
  notionParentPages: (orgId: string, integrationId: string, query: string) =>
    ['org', orgId, 'integrations', integrationId, 'notion', 'parent-pages', query] as const,
  mcpIntegrations: (orgId: string) => ['org', orgId, 'mcp-integrations'] as const,
  emailSuggestions: (orgId: string) => ['org', orgId, 'email-suggestions'] as const,
  emailSuggestionThread: (orgId: string, suggestionId: string) =>
    ['org', orgId, 'email-suggestions', suggestionId, 'thread'] as const,
  automationRules: (orgId: string) => ['org', orgId, 'automation-rules'] as const,
  savedViews: (orgId: string) => ['org', orgId, 'saved-views'] as const,
  workViewDefault: (orgId: string, target: string) =>
    ['org', orgId, 'work-view-default', target] as const,
  workView: (
    orgId: string,
    target: ViewTarget,
    instanceKey: string,
    requestKey: string,
    timezone: string,
  ) =>
    [
      ...workTargetCollectionKey(orgId, target),
      'work-view',
      target,
      instanceKey,
      timezone,
      requestKey,
    ] as const,
  workViewFacets: (
    orgId: string,
    target: ViewTarget,
    instanceKey: string,
    requestKey: string,
    timezone: string,
  ) =>
    [
      ...workTargetCollectionKey(orgId, target),
      'work-view-facets',
      target,
      instanceKey,
      timezone,
      requestKey,
    ] as const,
  // The settings page reads every kind at once and each composer picker reads one, so the kind is
  // part of the key: the four picker reads cache apart, and the coarse `templates(orgId)` prefix
  // invalidates all of them plus the settings list after any write.
  // Two reads, deliberately keyed apart. Pickers want the bare list and read it constantly; the
  // settings page wants the same list plus usage counts, which cost five aggregate queries. A
  // shared key would make every picker open pay for counts nobody is looking at.
  // A workspace's status sets, read by the shell once per session and by the settings page. The
  // team scope is part of the key because a team that keeps its own task statuses resolves to a
  // different set, and both have to be cacheable at the same time.
  statusSets: (orgId: string, teamId?: string) =>
    (teamId === undefined
      ? (['org', orgId, 'status-sets'] as const)
      : (['org', orgId, 'status-sets', teamId] as const)) as readonly unknown[],
  labels: (orgId: string) => ['org', orgId, 'labels'] as const,
  labelsWithCounts: (orgId: string) => ['org', orgId, 'labels', 'counts'] as const,
  labelGroups: (orgId: string) => ['org', orgId, 'label-groups'] as const,
  templates: (orgId: string) => ['org', orgId, 'templates'] as const,
  templatesOfKind: (orgId: string, targetType: string) =>
    ['org', orgId, 'templates', targetType] as const,
  agents: (orgId: string) => ['org', orgId, 'agents'] as const,
  sessions: (orgId: string) => ['org', orgId, 'sessions'] as const,
  views: (orgId: string) => ['org', orgId, 'views'] as const,
  // The dependency-graph read carries its scope (`org` / `project:<id>` / `task:<id>:<depth>`)
  // so each embed caches apart; the coarse `['org',orgId,'task-graph']` prefix invalidates all.
  taskGraph: (orgId: string, scopeKey: string) => ['org', orgId, 'task-graph', scopeKey] as const,
  settings: (orgId: string, tab: string) => ['org', orgId, 'settings', tab] as const,
  billing: (orgId: string) => ['org', orgId, 'settings', 'billing'] as const,
  billingDiscounts: (orgId: string) => ['org', orgId, 'settings', 'billing', 'discounts'] as const,
  connectedApps: () => ['me', 'connected-apps'] as const,
  identities: () => ['me', 'identities'] as const,
  publicConfig: () => ['public-config'] as const,
  account: () => ['me', 'account'] as const,
  accountExports: () => ['me', 'account', 'exports'] as const,
  accountExport: (exportId: string) => ['me', 'account', 'exports', exportId] as const,
  accountExportOptions: () => ['me', 'account', 'exports', 'options'] as const,
  recoveryCodes: () => ['me', 'recovery-codes'] as const,
  notificationPreferences: () => ['me', 'notification-preferences'] as const,
  contactPoints: () => ['me', 'contact-points'] as const,
  /** The caller's bound phone numbers — the identities Athena answers calls from. */
  phoneNumbers: () => ['me', 'phone-numbers'] as const,
  /** The recent conversation a voice session continues. */
  voiceTranscript: () => ['me', 'athena', 'voice', 'transcript'] as const,
  activeSessions: () => ['me', 'active-sessions'] as const,
  orgs: () => ['me', 'orgs'] as const,
  organization: (orgId: string) => ['org', orgId, 'detail'] as const,
  portfolio: () => ['me', 'portfolio'] as const,
  search: (scope: 'hub' | 'org', query: string, orgId?: string | null) =>
    ['search', scope, orgId ?? 'all', query] as const,
  // All mention keys share one prefix, so connecting an app invalidates the picker's whole cache
  // with a single coarse key rather than a list someone has to remember to extend.
  mentions: (orgId: string) => ['org', orgId, 'mentions'] as const,
  mentionLocal: (orgId: string, query: string) =>
    ['org', orgId, 'mentions', 'local', query] as const,
  mentionExternal: (orgId: string, query: string) =>
    ['org', orgId, 'mentions', 'external', query] as const,
  mentionHydrate: (orgId: string, batchKey: string) =>
    ['org', orgId, 'mentions', 'hydrate', batchKey] as const,
  entityMentions: (orgId: string, subjectType: string, subjectId: string) =>
    ['org', orgId, 'mentions', 'subject', subjectType, subjectId] as const,
  /** The inbound direction: what points *at* one entity or external resource. */
  references: (orgId: string, targetKind: string, targetId: string) =>
    ['org', orgId, 'references', targetKind, targetId] as const,
  hubSearch: (query: string) => ['me', 'search', query] as const,
  today: (date: string) => ['me', 'today', date] as const,
  /**
   * One narrated day.
   *
   * @remarks
   * Deliberately NOT nested under `['me','plan']`. Every review mutation invalidates that prefix, and
   * the highlights panel sits above the review's steps: sharing the prefix would re-read the review
   * and re-render the step tree on every debounced keystroke while somebody is mid-rewrite.
   */
  dayHighlights: (date: string) => ['me', 'highlights', date] as const,
  agenda: (date: string) => ['me', 'agenda', date] as const,
  dailyPlan: (date: string) => ['me', 'daily-plan', date] as const,
  calendarSettings: () => ['me', 'calendar-settings'] as const,
  workLocation: () => ['me', 'work-location'] as const,
  workLocationPoint: (at: string) => ['me', 'work-location', 'point', at] as const,
  workLocationRange: (start: string, end: string) =>
    ['me', 'work-location', 'range', start, end] as const,
  workLocationPlaces: () => ['me', 'work-location', 'places'] as const,
  workLocationAssertions: () => ['me', 'work-location', 'assertions'] as const,
  workLocationSync: () => ['me', 'work-location', 'sync-state'] as const,
  hubPreferences: () => ['me', 'hub-preferences'] as const,
  athena: () => ['me', 'athena'] as const,
  athenaPulse: () => ['me', 'athena', 'pulse'] as const,
  athenaSession: (sessionId: string) => ['me', 'athena', 'sessions', sessionId] as const,
  latticeConnection: () => ['me', 'athena', 'lattice'] as const,
  latticeDevices: () => ['me', 'athena', 'lattice', 'devices'] as const,
  calendarLayers: () => ['me', 'calendar-layers'] as const,
  calendarShares: (organizationId: string) => ['me', 'calendar-shares', organizationId] as const,
  scheduleComparison: (
    organizationId: string,
    actorIds: string,
    startISO: string,
    endISO: string,
  ) => ['org', organizationId, 'schedule-comparison', actorIds, startISO, endISO] as const,
  // Range-scoped, not nested under a shared list key — a range read is fetched fresh per
  // window rather than growing one unbounded cache entry, so `[start, end]` are part of the
  // key itself (same convention as `streamMe`/`streamOrg` carrying their filter params).
  calendarItems: (startISO: string, endISO: string) =>
    ['me', 'calendar-items', startISO, endISO] as const,
  // Deliberately NOT nested under `calendarItems(...)` — an item detail's key doesn't extend
  // any particular range key (an item can appear in many ranges). Targeted reads stay independent,
  // while the coarse `['me', 'calendar-items']` prefix intentionally refreshes both details and
  // every cached range after a write can change range membership (mirrors how `agenda`/`dailyPlan`
  // are separate sibling keys coordinated by their mutation layer rather than one nested under the
  // other).
  calendarItem: (itemId: string) => ['me', 'calendar-items', 'detail', itemId] as const,
  calendarItemRelations: (itemId: string) =>
    ['me', 'calendar-items', 'detail', itemId, 'relations'] as const,
  // Notification count is keyed UNDER the list so invalidating `notifications()` (a prefix
  // match) refreshes both the list and the pending-approval count in one call.
  notifications: () => ['me', 'notifications'] as const,
  notificationsCount: () => ['me', 'notifications', 'count'] as const,
  activity: () => ['me', 'activity'] as const,
  triage: (orgId: string) => ['org', orgId, 'triage'] as const,
  // Stream keys carry the serialized filter params so each filter variant caches apart; the
  // coarse `['me','stream']` / `['org',orgId,'stream']` prefixes invalidate every variant.
  streamMe: (params: string) => ['me', 'stream', params] as const,
  streamOrg: (orgId: string, params: string) => ['org', orgId, 'stream', params] as const,
  // The universal timer. `timeActive` is read by the shell on every authenticated surface, so the
  // whole family is nested under one `['me','time']` prefix: one invalidation after any timer
  // transition refreshes the running control, the analytics totals and the breakdown together,
  // which is what stops the header saying "running" while the report still says "idle".
  timeActive: () => ['me', 'time', 'active'] as const,
  timeSummary: (params: string) => ['me', 'time', 'summary', params] as const,
  timeBreakdown: (params: string) => ['me', 'time', 'breakdown', params] as const,
  timeTimeline: (params: string) => ['me', 'time', 'timeline', params] as const,
  timeCycles: () => ['me', 'time', 'cycles'] as const,
  timeCategories: () => ['me', 'time', 'categories'] as const,
  timeShareTokens: () => ['me', 'time', 'share-tokens'] as const,
  // Weekly auto-scheduling and the daily loop. Everything nests under one `['me','plan']` prefix
  // so a single invalidation after a planning run, a check-in answer or a review step refreshes
  // the week, the day's directive and the review together — the three surfaces that would
  // otherwise disagree about the same day.
  scheduleWeek: (weekStartDate: string) => ['me', 'plan', 'week', weekStartDate] as const,
  schedulePreferences: () => ['me', 'plan', 'preferences'] as const,
  workShapes: () => ['me', 'plan', 'shapes'] as const,
  dayDirective: (date: string) => ['me', 'plan', 'day', date, 'directive'] as const,
  dayStart: (date: string) => ['me', 'plan', 'day', date, 'start'] as const,
  dayCheckIns: (date: string) => ['me', 'plan', 'day', date, 'check-ins'] as const,
  dayReview: (date: string) => ['me', 'plan', 'day', date, 'review'] as const,
} as const;
