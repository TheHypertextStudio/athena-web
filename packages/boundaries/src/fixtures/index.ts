/**
 * `@docket/boundaries/fixtures` — deterministic sample data for the mock adapters.
 *
 * @remarks
 * Scripted agent sessions, sample connector issues/docs/events with provenance, and
 * a synthetic billing webhook sequence (`trialing → active → past_due → canceled`).
 * Everything here is fully deterministic — fixed ULID-shaped ids and a fixed ISO
 * timestamp — so the mock adapters and the suites that exercise them are stable.
 * The mock adapters consume these (see `../mock`).
 */
import type { BillingEventType, SubscriptionStatus } from '../ports/billing';
import type { SessionActivity } from '../ports/agent-runtime';
import type { ConnectorProvider, ImportedItem } from '../ports/connector';

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

/**
 * The scripted agent session the {@link FIXED_NOW}-anchored mock runtime replays:
 * `thought → action(proposed) → elicitation → response`.
 *
 * @remarks
 * The single `action` carries `approval: 'proposed'` so the hosting layer's approval
 * gate is exercised end-to-end against the mock.
 */
export const SCRIPTED_SESSION: readonly SessionActivity[] = [
  { type: 'thought', body: 'Reviewing the task and the current board state.' },
  {
    type: 'action',
    body: {
      kind: 'update_task',
      summary: 'Move task to In Progress',
      diff: { state: { from: 'todo', to: 'in_progress' } },
    },
    approval: 'proposed',
  },
  { type: 'elicitation', body: 'Should I also assign this task to you?' },
  { type: 'response', body: 'Proposed moving the task to In Progress; awaiting approval.' },
];

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
      title: 'Design the cross-org Hub',
      body: 'Spec the Hub landing surface and density preferences.',
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
      provenance: {
        provider: 'gtasks',
        externalId: 'gtasks-task-001',
        externalUrl: 'https://tasks.google.com/task/gtasks-task-001',
        importedAt: FIXED_NOW,
      },
    },
    {
      id: '01HZ0000000000000000GT0002',
      kind: 'issue',
      title: 'Book the venue for the offsite',
      body: 'Compare two quotes and reserve by Friday.',
      provenance: {
        provider: 'gtasks',
        externalId: 'gtasks-task-002',
        externalUrl: 'https://tasks.google.com/task/gtasks-task-002',
        importedAt: FIXED_NOW,
      },
    },
    {
      id: '01HZ0000000000000000GT0003',
      kind: 'issue',
      title: 'Reply to the partnership email',
      provenance: {
        provider: 'gtasks',
        externalId: 'gtasks-task-003',
        externalUrl: 'https://tasks.google.com/task/gtasks-task-003',
        importedAt: FIXED_NOW,
      },
    },
  ],
};

/** One step in the synthetic billing lifecycle the mock gateway can replay. */
export interface BillingLifecycleStep {
  /** The webhook event kind emitted at this step. */
  readonly event: BillingEventType;
  /** The subscription status after this step is applied. */
  readonly status: SubscriptionStatus;
  /** Hours from the gateway's `now` that the current period ends after this step. */
  readonly periodEndOffsetHours: number;
}

/**
 * The canonical billing lifecycle: `trialing → active → past_due → canceled`.
 *
 * @remarks
 * The mock gateway walks this script to emit deterministic synthetic webhook events
 * against which the real trial + data-lifecycle state machine + cron sweep are
 * tested.
 */
export const BILLING_LIFECYCLE: readonly BillingLifecycleStep[] = [
  { event: 'subscription.created', status: 'trialing', periodEndOffsetHours: 24 * 14 },
  { event: 'subscription.updated', status: 'active', periodEndOffsetHours: 24 * 30 },
  { event: 'subscription.past_due', status: 'past_due', periodEndOffsetHours: 24 * 3 },
  { event: 'subscription.canceled', status: 'canceled', periodEndOffsetHours: 0 },
];
