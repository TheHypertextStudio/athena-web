/**
 * `@docket/integrations` — deterministic sample data for integration test doubles.
 *
 * @remarks
 * Sample connector issues/docs/events with provenance and provider-specific work graph fixtures.
 * Everything here is fully deterministic — fixed ULID-shaped ids and a fixed ISO
 * timestamp — so the mock adapters and the suites that exercise them are stable.
 * The mock adapters consume these (see `../mock`).
 */
import type { ConnectorProvider, ImportedItem, ResourceRef } from './connector';
import type { MailThreadSummary } from './mail';
import type {
  ExternalCycle,
  ExternalLabel,
  ExternalProject,
  ExternalUser,
  ExternalWorkItem,
  ExternalWorkflowState,
  WorkGraphSnapshot,
} from './work-graph';

/**
 * The fixed "now" the deterministic fixtures and mock adapters anchor to.
 *
 * @remarks
 * Mock adapters accept an injectable `now` defaulting to this value so no fixture
 * ever reads the wall clock. Chosen to be stable and unambiguous.
 */
export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

/** A fixed clock factory for tests: always returns {@link FIXED_NOW}. */
export const fixedClock = (): string => FIXED_NOW;

/** One deterministic imported item per provider, with provenance. */
export const CONNECTOR_ITEMS: Readonly<Record<ConnectorProvider, readonly ImportedItem[]>> = {
  github: [
    {
      id: '01HZ0000000000000000GH0001',
      kind: 'issue',
      title: 'Fix flaky checkout test',
      body: 'The checkout integration test fails intermittently on CI.',
      provenance: {
        provider: 'github',
        externalId: 'octo/docket#42',
        externalUrl: 'https://github.com/octo/docket/issues/42',
        importedAt: FIXED_NOW,
      },
    },
  ],
  linear: [
    {
      id: '01HZ0000000000000000LN0001',
      kind: 'issue',
      title: 'Design the home dashboard',
      body: 'Spec the landing screen layout and density preferences.',
      provenance: {
        provider: 'linear',
        externalId: 'DOC-7',
        externalUrl: 'https://linear.app/docket/issue/DOC-7',
        importedAt: FIXED_NOW,
      },
    },
    {
      id: '01HZ0000000000000000LN0002',
      kind: 'issue',
      title: 'Wire up onboarding connect step',
      body: 'Mirror Linear, Google Tasks, and Calendar into a fresh workspace.',
      provenance: {
        provider: 'linear',
        externalId: 'DOC-12',
        externalUrl: 'https://linear.app/docket/issue/DOC-12',
        importedAt: FIXED_NOW,
      },
    },
  ],
  drive: [
    {
      id: '01HZ0000000000000000DR0001',
      kind: 'document',
      title: 'Q1 Planning Doc',
      body: 'Quarterly objectives and key results.',
      provenance: {
        provider: 'drive',
        externalId: 'drive-file-abc',
        externalUrl: 'https://drive.google.com/file/d/drive-file-abc',
        importedAt: FIXED_NOW,
      },
    },
  ],
  gmail: [
    {
      id: '01HZ0000000000000000GM0001',
      kind: 'message',
      title: 'Re: Contract renewal',
      body: 'Following up on the renewal terms.',
      provenance: { provider: 'gmail', externalId: 'gmail-thread-xyz', importedAt: FIXED_NOW },
    },
  ],
  outlook: [
    {
      id: '01HZ0000000000000000OL0001',
      kind: 'message',
      title: 'Can you review the vendor contract?',
      provenance: {
        provider: 'outlook',
        externalId: 'outlook-message-0001',
        externalUrl: 'https://outlook.mock.docket.local/mail/outlook-message-0001',
        importedAt: FIXED_NOW,
      },
    },
  ],
  calendar: [
    {
      id: '01HZ0000000000000000CL0001',
      kind: 'event',
      title: 'Weekly planning',
      body: 'Recurring Monday planning sync.',
      provenance: {
        provider: 'calendar',
        externalId: 'cal-event-123',
        externalUrl: 'https://calendar.google.com/calendar/event?eid=cal-event-123',
        importedAt: FIXED_NOW,
      },
    },
    {
      id: '01HZ0000000000000000CL0002',
      kind: 'event',
      title: 'Design review with Priya',
      body: 'Walk through the onboarding flow before launch.',
      provenance: {
        provider: 'calendar',
        externalId: 'cal-event-456',
        externalUrl: 'https://calendar.google.com/calendar/event?eid=cal-event-456',
        importedAt: FIXED_NOW,
      },
    },
  ],
  gtasks: [
    {
      id: '01HZ0000000000000000GT0001',
      kind: 'issue',
      title: 'Send the contractor agreement',
      body: 'Draft and send the signed agreement to legal.',
      completed: false,
      dueDate: null,
      provenance: {
        provider: 'gtasks',
        externalId: 'gtasks-task-001',
        externalUrl: 'https://tasks.google.com/task/gtasks-task-001',
        importedAt: FIXED_NOW,
        // Two-way anchors so an imported linked task is reconcilable (can go dirty + push).
        externalUpdatedAt: FIXED_NOW,
        externalEtag: 'etag-gtasks-001',
        externalListId: '@default',
      },
    },
    {
      id: '01HZ0000000000000000GT0002',
      kind: 'issue',
      title: 'Book the venue for the offsite',
      body: 'Compare two quotes and reserve by Friday.',
      completed: false,
      dueDate: null,
      provenance: {
        provider: 'gtasks',
        externalId: 'gtasks-task-002',
        externalUrl: 'https://tasks.google.com/task/gtasks-task-002',
        importedAt: FIXED_NOW,
        externalUpdatedAt: FIXED_NOW,
        externalEtag: 'etag-gtasks-002',
        externalListId: '@default',
      },
    },
    {
      id: '01HZ0000000000000000GT0003',
      kind: 'issue',
      title: 'Reply to the partnership email',
      completed: false,
      dueDate: null,
      provenance: {
        provider: 'gtasks',
        externalId: 'gtasks-task-003',
        externalUrl: 'https://tasks.google.com/task/gtasks-task-003',
        importedAt: FIXED_NOW,
        externalUpdatedAt: FIXED_NOW,
        externalEtag: 'etag-gtasks-003',
        externalListId: 'mock-list-work',
      },
    },
  ],
};

/**
 * The two mock Linear teams {@link LINEAR_WORK_GRAPH} and {@link LINEAR_TEAM_STATES} are
 * scoped against.
 *
 * @remarks
 * Matches the container shape the real Linear client's `listContainers` returns (`id` +
 * `title` per {@link ResourceRef}) — every {@link LINEAR_WORK_GRAPH} item/project/cycle's
 * `externalTeamId`(s) resolve to one of these two ids.
 */
export const LINEAR_TEAMS: readonly ResourceRef[] = [
  { id: 'lin-team-eng', title: 'Engineering' },
  { id: 'lin-team-ops', title: 'Ops' },
];

/**
 * Each {@link LINEAR_TEAMS} team's workflow states, covering every
 * {@link import('./work-graph').ExternalStateType}.
 *
 * @remarks
 * Keyed by team external id; an id absent from this map has no defined states (mirrors the
 * real client's `listTeamStates`, which returns an empty array for an unrecognized or
 * stateless team rather than throwing).
 */
export const LINEAR_TEAM_STATES: Readonly<Record<string, readonly ExternalWorkflowState[]>> = {
  'lin-team-eng': [
    { externalId: 'lin-state-eng-backlog', name: 'Backlog', type: 'backlog', position: 1 },
    { externalId: 'lin-state-eng-todo', name: 'Todo', type: 'unstarted', position: 2 },
    { externalId: 'lin-state-eng-progress', name: 'In Progress', type: 'started', position: 3 },
    { externalId: 'lin-state-eng-done', name: 'Done', type: 'completed', position: 4 },
    { externalId: 'lin-state-eng-canceled', name: 'Canceled', type: 'canceled', position: 5 },
  ],
  'lin-team-ops': [
    { externalId: 'lin-state-ops-backlog', name: 'Backlog', type: 'backlog', position: 1 },
    { externalId: 'lin-state-ops-todo', name: 'Todo', type: 'unstarted', position: 2 },
    { externalId: 'lin-state-ops-progress', name: 'In Progress', type: 'started', position: 3 },
    { externalId: 'lin-state-ops-done', name: 'Done', type: 'completed', position: 4 },
    { externalId: 'lin-state-ops-canceled', name: 'Canceled', type: 'canceled', position: 5 },
  ],
};

/** The matched mock Linear user — its `email` is the one downstream member-matching tests key off. */
const LINEAR_USER_MEMBER: ExternalUser = {
  externalId: 'lin-user-member',
  displayName: 'Sam Member',
  email: 'member@example.com',
  active: true,
};

/** An unmatched mock Linear user — no `email`, so member-matching never resolves it. */
const LINEAR_USER_EXTERNAL: ExternalUser = {
  externalId: 'lin-user-external',
  displayName: 'External Contributor',
  active: true,
};

/** A workspace-level label (no `externalTeamId`). */
const LINEAR_LABEL_BUG: ExternalLabel = {
  externalId: 'lin-label-bug',
  name: 'Bug',
  color: '#e05d44',
};

/** A second workspace-level label. */
const LINEAR_LABEL_CHORE: ExternalLabel = {
  externalId: 'lin-label-chore',
  name: 'Chore',
  color: '#4287f5',
};

/** A team-scoped label, owned by the `lin-team-eng` team. */
const LINEAR_LABEL_ENG_DESIGN: ExternalLabel = {
  externalId: 'lin-label-eng-design',
  name: 'Needs Design',
  color: '#a742f5',
  externalTeamId: 'lin-team-eng',
};

/** An active project, led by the matched user, shared across both teams. */
const LINEAR_PROJECT_ACTIVE: ExternalProject = {
  externalId: 'lin-project-active',
  name: 'Platform Revamp',
  state: 'started',
  leadExternalId: 'lin-user-member',
  startDate: '2026-01-01',
  targetDate: '2026-06-01',
  url: 'https://linear.app/docket/project/platform-revamp',
  updatedAt: '2026-01-05T00:00:00.000Z',
  externalTeamIds: ['lin-team-eng', 'lin-team-ops'],
};

/** A completed project, scoped to `lin-team-eng` only. */
const LINEAR_PROJECT_DONE: ExternalProject = {
  externalId: 'lin-project-done',
  name: 'Legacy Migration',
  state: 'completed',
  url: 'https://linear.app/docket/project/legacy-migration',
  updatedAt: '2025-12-01T00:00:00.000Z',
  externalTeamIds: ['lin-team-eng'],
};

/** An active cycle on `lin-team-eng` whose window straddles {@link FIXED_NOW}. */
const LINEAR_CYCLE_ACTIVE: ExternalCycle = {
  externalId: 'lin-cycle-active',
  externalTeamId: 'lin-team-eng',
  number: 5,
  name: 'Cycle 5',
  startsAt: '2025-12-25T00:00:00.000Z',
  endsAt: '2026-01-08T00:00:00.000Z',
  updatedAt: '2025-12-25T00:00:00.000Z',
};

/** A completed cycle on `lin-team-ops`. */
const LINEAR_CYCLE_DONE: ExternalCycle = {
  externalId: 'lin-cycle-done',
  externalTeamId: 'lin-team-ops',
  number: 4,
  name: 'Cycle 4',
  startsAt: '2025-11-01T00:00:00.000Z',
  endsAt: '2025-11-14T00:00:00.000Z',
  completedAt: '2025-11-14T00:00:00.000Z',
  updatedAt: '2025-11-14T00:00:00.000Z',
};

/** Assigned to the matched user, urgent, labeled, project + cycle linked. */
const LINEAR_ISSUE_1: ExternalWorkItem = {
  externalId: 'lin-issue-1',
  identifier: 'ENG-1',
  title: 'Design the sync reconciler',
  stateType: 'started',
  stateName: 'In Progress',
  priority: 'urgent',
  assigneeExternalId: 'lin-user-member',
  labelExternalIds: ['lin-label-bug'],
  projectExternalId: 'lin-project-active',
  cycleExternalId: 'lin-cycle-active',
  externalTeamId: 'lin-team-eng',
  url: 'https://linear.app/docket/issue/ENG-1',
  updatedAt: '2025-12-01T00:00:00.000Z',
};

/** Unassigned, high priority, two labels (one workspace, one team-scoped). */
const LINEAR_ISSUE_2: ExternalWorkItem = {
  externalId: 'lin-issue-2',
  identifier: 'ENG-2',
  title: 'Audit label mapping edge cases',
  stateType: 'unstarted',
  stateName: 'Todo',
  priority: 'high',
  labelExternalIds: ['lin-label-chore', 'lin-label-eng-design'],
  externalTeamId: 'lin-team-eng',
  url: 'https://linear.app/docket/issue/ENG-2',
  updatedAt: '2025-12-15T00:00:00.000Z',
};

/** The parent half of the fixture's one parent/child pair; assigned to the unmatched user. */
const LINEAR_ISSUE_3: ExternalWorkItem = {
  externalId: 'lin-issue-3',
  identifier: 'ENG-3',
  title: 'Parent: rework onboarding checklist',
  stateType: 'backlog',
  stateName: 'Backlog',
  priority: 'medium',
  assigneeExternalId: 'lin-user-external',
  labelExternalIds: [],
  externalTeamId: 'lin-team-eng',
  url: 'https://linear.app/docket/issue/ENG-3',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** The child half of the fixture's one parent/child pair. */
const LINEAR_ISSUE_4: ExternalWorkItem = {
  externalId: 'lin-issue-4',
  identifier: 'ENG-4',
  title: 'Child: write onboarding copy',
  stateType: 'started',
  stateName: 'In Progress',
  priority: 'low',
  labelExternalIds: [],
  parentExternalId: 'lin-issue-3',
  externalTeamId: 'lin-team-eng',
  url: 'https://linear.app/docket/issue/ENG-4',
  updatedAt: '2026-01-10T00:00:00.000Z',
};

/** Completed, no priority, carries an estimate + a due date, project + cycle linked. */
const LINEAR_ISSUE_5: ExternalWorkItem = {
  externalId: 'lin-issue-5',
  identifier: 'OPS-1',
  title: 'Ship the mirror rollout runbook',
  stateType: 'completed',
  stateName: 'Done',
  priority: 'none',
  labelExternalIds: [],
  projectExternalId: 'lin-project-done',
  cycleExternalId: 'lin-cycle-done',
  externalTeamId: 'lin-team-ops',
  estimate: 3,
  dueDate: '2026-02-01',
  url: 'https://linear.app/docket/issue/OPS-1',
  updatedAt: '2026-01-15T00:00:00.000Z',
};

/** The fixture's one canceled issue (`canceledAt` set alongside `stateType: 'canceled'`). */
const LINEAR_ISSUE_6: ExternalWorkItem = {
  externalId: 'lin-issue-6',
  identifier: 'OPS-2',
  title: 'Retire the legacy webhook relay',
  stateType: 'canceled',
  stateName: 'Canceled',
  priority: 'urgent',
  labelExternalIds: [],
  canceledAt: '2026-01-20T00:00:00.000Z',
  externalTeamId: 'lin-team-ops',
  url: 'https://linear.app/docket/issue/OPS-2',
  updatedAt: '2026-01-20T00:00:00.000Z',
};

/** The fixture's one tombstone (`removed: true`) — archived at the provider, not live content. */
const LINEAR_ISSUE_7: ExternalWorkItem = {
  externalId: 'lin-issue-7',
  identifier: 'ENG-5',
  title: 'Archived spike: evaluate GraphQL subscriptions',
  stateType: 'unstarted',
  stateName: 'Todo',
  priority: 'high',
  labelExternalIds: [],
  externalTeamId: 'lin-team-eng',
  url: 'https://linear.app/docket/issue/ENG-5',
  updatedAt: '2026-01-25T00:00:00.000Z',
  removed: true,
};

/**
 * The full mock Linear work graph: 2 users, 3 labels, 2 projects, 2 cycles, 7 work items.
 *
 * @remarks
 * Deterministic and fixed — no `Date.now()`/`new Date()` at module scope. Exercises every
 * mapping branch the real client's issue/project/cycle mapping can produce: an assigned and
 * several unassigned items, all five {@link import('./work-graph').ExternalPriority}
 * values, attached labels, project+cycle linkage, a parent/child pair, a tombstone, an
 * estimate+due-date item, and a canceled item.
 * {@link import('./mock-connector').MockConnector.pullWorkGraph} filters this snapshot by
 * team and by `updatedAfter`; downstream reconciler tests assert exact counts against it, so
 * any edit here is a fixture-contract change.
 */
export const LINEAR_WORK_GRAPH: WorkGraphSnapshot = {
  users: [LINEAR_USER_MEMBER, LINEAR_USER_EXTERNAL],
  labels: [LINEAR_LABEL_BUG, LINEAR_LABEL_CHORE, LINEAR_LABEL_ENG_DESIGN],
  projects: [LINEAR_PROJECT_ACTIVE, LINEAR_PROJECT_DONE],
  cycles: [LINEAR_CYCLE_ACTIVE, LINEAR_CYCLE_DONE],
  items: [
    LINEAR_ISSUE_1,
    LINEAR_ISSUE_2,
    LINEAR_ISSUE_3,
    LINEAR_ISSUE_4,
    LINEAR_ISSUE_5,
    LINEAR_ISSUE_6,
    LINEAR_ISSUE_7,
  ],
};

/**
 * Deterministic mailbox thread summaries served by the mock connector's `listThreads`,
 * keyed by mail-capable provider.
 *
 * @remarks
 * Two fixtures per provider, chosen to exercise the email-to-task funnel both ways
 * offline: one actionable thread from a real person (passes), and one promotional
 * thread from a no-reply sender (floored + tagged `promotions`, so the seeded
 * dismiss-promotions automation fires). Timestamps anchor to {@link FIXED_NOW}; the
 * RFC 5322 `Message-ID`s are stable for cross-provider dedup tests.
 */
export const MAIL_THREAD_SUMMARIES: Readonly<
  Partial<Record<ConnectorProvider, readonly MailThreadSummary[]>>
> = {
  gmail: [
    {
      threadId: 'gmail-thread-actionable',
      subject: 'Can you review the vendor contract?',
      snippet: 'Can you review the vendor contract before Friday? Legal needs a confirm.',
      from: 'Ada Lovelace <ada@example.com>',
      receivedAt: FIXED_NOW,
      rfc822MessageId: '<actionable-0001@example.com>',
      externalUrl: 'https://mail.mock.docket.local/#all/gmail-thread-actionable',
    },
    {
      threadId: 'gmail-thread-promo',
      subject: '50% off everything this weekend',
      snippet: 'Huge sale — 50% off sitewide. Unsubscribe at any time.',
      from: 'Deals <no-reply@shop.example.com>',
      receivedAt: FIXED_NOW,
      rfc822MessageId: '<promo-0001@shop.example.com>',
      externalUrl: 'https://mail.mock.docket.local/#all/gmail-thread-promo',
    },
  ],
  outlook: [
    {
      threadId: 'outlook-conversation-actionable',
      subject: 'Can you send the signed NDA back by Thursday?',
      snippet: 'Can you send the signed NDA back by Thursday? Legal is waiting on it.',
      from: 'Grace Hopper <grace@example.com>',
      receivedAt: FIXED_NOW,
      // Deliberately matches no Gmail fixture: cross-provider dedup is exercised by tests
      // that reuse a Message-ID across providers, not by the default fixture sets.
      rfc822MessageId: '<outlook-actionable-0001@example.com>',
      externalUrl: 'https://outlook.mock.docket.local/mail/outlook-conversation-actionable',
    },
    {
      threadId: 'outlook-conversation-promo',
      subject: 'Last chance: 40% off annual plans',
      snippet: 'Upgrade now and save. Unsubscribe from these offers any time.',
      from: 'Offers <no-reply@saas.example.com>',
      receivedAt: FIXED_NOW,
      rfc822MessageId: '<outlook-promo-0001@saas.example.com>',
      externalUrl: 'https://outlook.mock.docket.local/mail/outlook-conversation-promo',
    },
  ],
};
