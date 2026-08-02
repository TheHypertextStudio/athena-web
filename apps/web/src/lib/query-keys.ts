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
  tasks: (orgId: string) => ['org', orgId, 'tasks'] as const,
  task: (orgId: string, taskId: string) => ['org', orgId, 'tasks', taskId] as const,
  // Nested under the task's own detail key on purpose: every task mutation already invalidates
  // `queryKeys.task(...)`, and prefix matching carries that through to the history, so editing a
  // property re-reads the entry it just wrote without any call site knowing the log exists.
  taskActivity: (orgId: string, taskId: string) =>
    ['org', orgId, 'tasks', taskId, 'activity'] as const,
  // Publishing keys nest under one `publishing` segment so a publish/withdraw can invalidate the
  // whole area (a brief's reachable URLs depend on the workspace's domains AND its public name)
  // with a single coarse prefix, while a detail read still has its own targeted key.
  publications: (orgId: string) => ['org', orgId, 'publishing', 'publications'] as const,
  publication: (orgId: string, subjectKind: string, subjectId: string) =>
    ['org', orgId, 'publishing', 'publications', subjectKind, subjectId] as const,
  workspaceDomains: (orgId: string) => ['org', orgId, 'publishing', 'domains'] as const,
  workspacePublicName: (orgId: string) => ['org', orgId, 'publishing', 'public-name'] as const,
  workspaceSuggestedName: (orgId: string) =>
    ['org', orgId, 'publishing', 'suggested-name'] as const,
  programs: (orgId: string) => ['org', orgId, 'programs'] as const,
  program: (orgId: string, programId: string) => ['org', orgId, 'programs', programId] as const,
  initiatives: (orgId: string) => ['org', orgId, 'initiatives'] as const,
  initiative: (orgId: string, initiativeId: string) =>
    ['org', orgId, 'initiatives', initiativeId] as const,
  cycles: (orgId: string) => ['org', orgId, 'cycles'] as const,
  cycle: (orgId: string, cycleId: string) => ['org', orgId, 'cycles', cycleId] as const,
  teams: (orgId: string) => ['org', orgId, 'teams'] as const,
  team: (orgId: string, teamId: string) => ['org', orgId, 'teams', teamId] as const,
  milestones: (orgId: string) => ['org', orgId, 'milestones'] as const,
  members: (orgId: string) => ['org', orgId, 'members'] as const,
  roles: (orgId: string) => ['org', orgId, 'roles'] as const,
  invitations: (orgId: string) => ['org', orgId, 'invitations'] as const,
  integrations: (orgId: string) => ['org', orgId, 'integrations'] as const,
  integrationLists: (orgId: string, integrationId: string) =>
    ['org', orgId, 'integrations', integrationId, 'lists'] as const,
  integrationsDirectory: (orgId: string) => ['org', orgId, 'integrations-directory'] as const,
  mcpIntegrations: (orgId: string) => ['org', orgId, 'mcp-integrations'] as const,
  emailSuggestions: (orgId: string) => ['org', orgId, 'email-suggestions'] as const,
  emailSuggestionThread: (orgId: string, suggestionId: string) =>
    ['org', orgId, 'email-suggestions', suggestionId, 'thread'] as const,
  automationRules: (orgId: string) => ['org', orgId, 'automation-rules'] as const,
  savedViews: (orgId: string) => ['org', orgId, 'saved-views'] as const,
  agents: (orgId: string) => ['org', orgId, 'agents'] as const,
  sessions: (orgId: string) => ['org', orgId, 'sessions'] as const,
  views: (orgId: string) => ['org', orgId, 'views'] as const,
  // The dependency-graph read carries its scope (`org` / `project:<id>` / `task:<id>:<depth>`)
  // so each embed caches apart; the coarse `['org',orgId,'task-graph']` prefix invalidates all.
  taskGraph: (orgId: string, scopeKey: string) => ['org', orgId, 'task-graph', scopeKey] as const,
  settings: (orgId: string, tab: string) => ['org', orgId, 'settings', tab] as const,
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
  activeSessions: () => ['me', 'active-sessions'] as const,
  orgs: () => ['me', 'orgs'] as const,
  organization: (orgId: string) => ['org', orgId, 'detail'] as const,
  portfolio: () => ['me', 'portfolio'] as const,
  search: (scope: 'hub' | 'org', query: string, orgId?: string | null) =>
    ['search', scope, orgId ?? 'all', query] as const,
  hubSearch: (query: string) => ['me', 'search', query] as const,
  today: (date: string) => ['me', 'today', date] as const,
  agenda: (date: string) => ['me', 'agenda', date] as const,
  dailyPlan: (date: string) => ['me', 'daily-plan', date] as const,
  calendarSettings: () => ['me', 'calendar-settings'] as const,
  hubPreferences: () => ['me', 'hub-preferences'] as const,
  athena: () => ['me', 'athena'] as const,
  athenaPulse: () => ['me', 'athena', 'pulse'] as const,
  athenaSession: (sessionId: string) => ['me', 'athena', 'sessions', sessionId] as const,
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
  timeShareTokens: () => ['me', 'time', 'share-tokens'] as const,
} as const;
