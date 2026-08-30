import type { Page } from '@playwright/test';

/** Put a rendered route into a named interaction state before each captured frame. */
export type MobileLayoutStateSetup = (page: Page) => Promise<void>;

/** One rendered route or interaction state that the responsive audit captures in every viewport and theme. */
export interface MobileLayoutRouteCase {
  /** Stable identifier used in the audit record and screenshot paths. */
  readonly id: string;
  /** Route template. Fixture identifiers are resolved by capture-shots.ts. */
  readonly route: string;
  /** Optional rendered interaction state that this case must open before capture. */
  readonly setup?: MobileLayoutStateSetup | undefined;
  /** Use a clean browser context so an authenticated session cannot redirect this surface. */
  readonly authenticated?: boolean | undefined;
}

/**
 * The complete route-level mobile layout audit.
 *
 * Overlay states live in their owning Playwright journeys. A route capture is not permitted to
 * claim that a menu or dialog works, so those stateful checks remain separate from this manifest.
 */
export const MOBILE_LAYOUT_ROUTE_CASES: readonly MobileLayoutRouteCase[] = [
  { id: 'athena', route: '/athena' },
  { id: 'athena-mail', route: '/athena/mail' },
  { id: 'calendar', route: '/calendar' },
  { id: 'focus', route: '/focus' },
  { id: 'inbox', route: '/inbox' },
  { id: 'plan', route: '/plan' },
  { id: 'portfolio', route: '/portfolio' },
  { id: 'search', route: '/search' },
  { id: 'stream', route: '/stream' },
  { id: 'tasks', route: '/tasks' },
  { id: 'time', route: '/time' },
  { id: 'today', route: '/today' },
  { id: 'workspace-new', route: '/workspaces/new' },
  { id: 'workspace-home', route: '/orgs/:sharedOrgId' },
  { id: 'workspace-cycles', route: '/orgs/:sharedOrgId/cycles' },
  { id: 'workspace-cycle', route: '/orgs/:sharedOrgId/cycles/:cycleId' },
  { id: 'workspace-graph', route: '/orgs/:sharedOrgId/graph' },
  { id: 'workspace-initiatives', route: '/orgs/:sharedOrgId/initiatives' },
  { id: 'workspace-initiative', route: '/orgs/:sharedOrgId/initiatives/:initiativeId' },
  { id: 'workspace-library', route: '/orgs/:sharedOrgId/library' },
  { id: 'workspace-my-work', route: '/orgs/:sharedOrgId/my-work' },
  { id: 'workspace-people', route: '/orgs/:sharedOrgId/people' },
  { id: 'workspace-person', route: '/orgs/:sharedOrgId/people/:actorId' },
  { id: 'workspace-programs', route: '/orgs/:sharedOrgId/programs' },
  { id: 'workspace-program', route: '/orgs/:sharedOrgId/programs/:programId' },
  { id: 'workspace-projects', route: '/orgs/:sharedOrgId/projects' },
  { id: 'workspace-project', route: '/orgs/:sharedOrgId/projects/:projectId' },
  { id: 'workspace-recurrence', route: '/orgs/:sharedOrgId/recurrence-series/:seriesId' },
  { id: 'workspace-search', route: '/orgs/:sharedOrgId/search' },
  { id: 'workspace-session', route: '/orgs/:sharedOrgId/sessions/:sessionId' },
  { id: 'workspace-stream', route: '/orgs/:sharedOrgId/stream' },
  { id: 'workspace-tasks', route: '/orgs/:sharedOrgId/tasks' },
  { id: 'workspace-task', route: '/orgs/:sharedOrgId/tasks/:taskId' },
  { id: 'workspace-teams', route: '/orgs/:sharedOrgId/teams' },
  { id: 'workspace-team', route: '/orgs/:sharedOrgId/teams/:teamId' },
  { id: 'workspace-triage', route: '/orgs/:sharedOrgId/triage' },
  { id: 'workspace-views', route: '/orgs/:sharedOrgId/views' },
  { id: 'settings', route: '/settings' },
  { id: 'settings-athena', route: '/settings/athena' },
  { id: 'settings-calendar', route: '/settings/calendar' },
  { id: 'settings-connected-accounts', route: '/settings/connected-accounts' },
  { id: 'settings-connected-apps', route: '/settings/connected-apps' },
  { id: 'settings-connections', route: '/settings/connections' },
  { id: 'settings-data-privacy', route: '/settings/data-privacy' },
  { id: 'settings-notifications', route: '/settings/notifications' },
  { id: 'settings-profile', route: '/settings/profile' },
  { id: 'settings-security', route: '/settings/security' },
  { id: 'settings-work-locations', route: '/settings/work-locations' },
  { id: 'workspace-settings', route: '/orgs/:sharedOrgId/settings' },
  { id: 'workspace-settings-automations', route: '/orgs/:sharedOrgId/settings/automations' },
  { id: 'workspace-settings-billing', route: '/orgs/:sharedOrgId/settings/billing' },
  { id: 'workspace-settings-connections', route: '/orgs/:sharedOrgId/settings/connections' },
  { id: 'workspace-settings-general', route: '/orgs/:sharedOrgId/settings/general' },
  { id: 'workspace-settings-import', route: '/orgs/:sharedOrgId/settings/import' },
  { id: 'workspace-settings-labels', route: '/orgs/:sharedOrgId/settings/labels' },
  { id: 'workspace-settings-members', route: '/orgs/:sharedOrgId/settings/members' },
  { id: 'workspace-settings-publishing', route: '/orgs/:sharedOrgId/settings/publishing' },
  { id: 'workspace-settings-statuses', route: '/orgs/:sharedOrgId/settings/statuses' },
  { id: 'workspace-settings-templates', route: '/orgs/:sharedOrgId/settings/templates' },
  { id: 'workspace-settings-work-structure', route: '/orgs/:sharedOrgId/settings/work-structure' },
  { id: 'settings-google-calendar', route: '/settings/connections/google-calendar' },
  {
    id: 'workspace-settings-google-calendar',
    route: '/orgs/:sharedOrgId/settings/connections/google-calendar',
  },
  { id: 'workspace-settings-notion', route: '/orgs/:sharedOrgId/settings/connections/notion' },
  {
    id: 'workspace-settings-notion-people',
    route: '/orgs/:sharedOrgId/settings/connections/notion/people',
  },
  { id: 'marketing-home', route: '/' },
  { id: 'marketing-about', route: '/about' },
  { id: 'marketing-pricing', route: '/pricing' },
  { id: 'marketing-privacy', route: '/privacy' },
  { id: 'marketing-problems', route: '/problems' },
  { id: 'marketing-terms', route: '/terms' },
  { id: 'open-router', route: '/open' },
  { id: 'auth-sign-in', route: '/sign-in', authenticated: false },
  { id: 'auth-sign-up', route: '/sign-up', authenticated: false },
  { id: 'auth-recover', route: '/recover', authenticated: false },
  {
    id: 'overlay-filter',
    route: '/orgs/:sharedOrgId/tasks',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Filter' }).click();
      await page.getByRole('dialog', { name: 'Filter tasks' }).waitFor();
    },
  },
  {
    id: 'overlay-filter-advanced',
    route: '/orgs/:sharedOrgId/tasks',
    setup: async (page) => {
      const filterButton = page.getByRole('button', { name: 'Filter' });
      await filterButton.click();
      const filter = page.getByRole('dialog', { name: 'Filter tasks' });
      await filter.getByRole('button', { name: 'Advanced filter' }).click();
      await filter.getByRole('button', { name: 'Apply filter' }).waitFor();
    },
  },
  {
    id: 'overlay-display',
    route: '/orgs/:sharedOrgId/tasks',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Display' }).click();
      await page.getByRole('dialog', { name: 'Display view' }).waitFor();
    },
  },
  {
    id: 'overlay-display-organize',
    route: '/orgs/:sharedOrgId/tasks',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Display' }).click();
      const display = page.getByRole('dialog', { name: 'Display view' });
      await display.getByRole('button', { name: 'Organize' }).click();
      await display.getByRole('heading', { name: 'Organize' }).waitFor();
    },
  },
  {
    id: 'overlay-display-properties',
    route: '/orgs/:sharedOrgId/tasks',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Display' }).click();
      const display = page.getByRole('dialog', { name: 'Display view' });
      await display.getByRole('button', { name: 'Properties' }).click();
      await display.getByRole('heading', { name: 'Properties' }).waitFor();
    },
  },
  {
    id: 'overlay-calendar-create',
    route: '/calendar',
    setup: async (page) => {
      await page.getByRole('button', { name: 'New' }).click();
      await page.getByRole('dialog', { name: 'Create calendar item' }).waitFor();
    },
  },
  {
    id: 'overlay-command-palette',
    route: '/today',
    setup: async (page) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    },
  },
  {
    id: 'overlay-navigation-sheet',
    route: '/today',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.getByRole('dialog', { name: 'Navigation' }).waitFor();
    },
  },
  {
    id: 'overlay-calendar-display',
    route: '/calendar',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Display settings' }).click();
      await page.getByRole('menu').waitFor();
    },
  },
  {
    id: 'calendar-people-axis',
    route: '/calendar',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Display settings' }).click();
      await page.getByRole('menuitemradio', { name: 'People' }).click();
      await page.getByRole('heading', { name: /People|August/ }).waitFor();
    },
  },
  {
    id: 'overlay-time-add-past',
    route: '/time',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Add past time' }).click();
      await page.getByRole('dialog', { name: 'Add past time' }).waitFor();
    },
  },
  {
    id: 'time-view-control',
    route: '/time',
    setup: async (page) => {
      await page.getByRole('group', { name: 'Time view' }).waitFor();
    },
  },
  {
    id: 'inbox-feed-tabs',
    route: '/inbox',
    setup: async (page) => {
      await page.getByRole('tablist', { name: 'Inbox feeds' }).waitFor();
    },
  },
];
