/**
 * Widget evidence fixtures: the work list and the day plan.
 */
import { PLAN_HTML } from '../../../api/src/mcp/apps/plan';
import { WORK_LIST_HTML } from '../../../api/src/mcp/apps/work-list';
import { day, type WidgetCase } from './widget-fixtures';

/** One page of a long list, as `list_work` returns it. */
function page(from: number, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p_${from + index}`,
    title: `Follow up with volunteer ${from + index + 1}`,
    href: `/orgs/org_1/tasks/p_${from + index}`,
    state: 'todo',
    stateType: 'unstarted',
    project: 'Week Without Driving 2026',
    dueDate: day((from + index) % 7),
  }));
}

/** The work lists and the day plan. */
export const LIST_CASES: readonly WidgetCase[] = [
  {
    // A list longer than one page: fullscreen follows the cursor by calling list_work again.
    name: 'work-list-load-more',
    tool: 'list_work',
    html: WORK_LIST_HTML,
    input: { orgId: 'org_1', entity: 'task', project: 'Week Without Driving 2026', limit: 8 },
    fullscreen: true,
    result: {
      structuredContent: {
        entity: 'task',
        listHref: '/orgs/org_1/tasks',
        items: page(0, 8),
        nextCursor: 'c_8',
      },
    },
    nextPage: { entity: 'task', listHref: '/orgs/org_1/tasks', items: page(8, 8) },
  },
  {
    // The real shape of a "what am I working on" answer: one person, mixed states, and the facts
    // that separate one row from another. Due dates are relative to the run so the card is
    // photographed with a genuine overdue row rather than a date that ages into one.
    name: 'work-list-populated',
    tool: 'list_work',
    html: WORK_LIST_HTML,
    input: { orgId: 'org_1', assignee: 'Sarah Okafor', state: ['in_progress', 'todo'] },
    result: {
      structuredContent: {
        entity: 'task',
        listHref: '/orgs/org_1/tasks',
        items: [
          {
            id: 't_1',
            href: '/orgs/org_1/tasks/t_1',
            title: 'Draft the Q3 service change memo',
            state: 'in_progress',
            stateType: 'started',
            project: 'Campus tabling',
            assignee: 'Sarah Okafor',
            dueDate: day(-3),
          },
          {
            id: 't_2',
            href: '/orgs/org_1/tasks/t_2',
            title: 'Review campus outreach budget',
            state: 'todo',
            stateType: 'unstarted',
            project: 'Bus Buddies',
            assignee: 'Sarah Okafor',
            cycle: 'Cycle 12',
            dueDate: day(0),
          },
          {
            id: 't_3',
            href: '/orgs/org_1/tasks/t_3',
            title: 'Send the RTC coordination follow-up',
            state: 'todo',
            stateType: 'unstarted',
            parent: 'RTC quarterly review',
            assignee: 'Sarah Okafor',
            dueDate: day(3),
          },
          {
            id: 't_4',
            href: '/orgs/org_1/tasks/t_4',
            title: 'Book the NSU tabling slot',
            state: 'backlog',
            stateType: 'backlog',
            project: 'Campus tabling',
            assignee: 'Sarah Okafor',
            dueDate: day(19),
          },
          {
            id: 't_5',
            href: '/orgs/org_1/tasks/t_5',
            title: 'Reconcile the UNLV headcount',
            state: 'todo',
            project: 'Campus tabling',
            assignee: 'Sarah Okafor',
          },
        ],
      },
    },
  },
  {
    name: 'work-list-every-state-type',
    tool: 'list_work',
    html: WORK_LIST_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        entity: 'task',
        items: [
          // Deliberately renamed state keys against canonical types: the glyph must follow the
          // type, and the text must follow whatever the team calls it.
          { id: 't_1', title: 'Icebox: fare capping pilot', state: 'icebox', stateType: 'backlog' },
          {
            id: 't_2',
            title: 'Queued: Maryland Pkwy counts',
            state: 'queued',
            stateType: 'unstarted',
          },
          {
            id: 't_3',
            title: 'Doing: Q3 service change memo',
            state: 'doing',
            stateType: 'started',
          },
          {
            id: 't_4',
            title: 'Shipped: NSU tabling slot',
            state: 'shipped',
            stateType: 'completed',
          },
          {
            id: 't_5',
            title: 'Dropped: legacy pass reconcile',
            state: 'dropped',
            stateType: 'canceled',
          },
        ],
      },
    },
  },
  {
    name: 'work-list-fullscreen',
    tool: 'list_work',
    html: WORK_LIST_HTML,
    input: { orgId: 'org_1' },
    fullscreen: true,
    result: {
      structuredContent: {
        entity: 'task',
        listHref: '/orgs/org_1/tasks',
        items: [
          {
            id: 't_1',
            href: '/orgs/org_1/tasks/t_1',
            title: 'Draft the Q3 service change memo',
            state: 'doing',
            stateType: 'started',
          },
          {
            id: 't_2',
            title: 'Reconcile the UNLV headcount',
            state: 'doing',
            stateType: 'started',
          },
          {
            id: 't_3',
            title: 'Review campus outreach budget',
            state: 'queued',
            stateType: 'unstarted',
          },
          {
            id: 't_4',
            title: 'Send the RTC coordination follow-up',
            state: 'queued',
            stateType: 'unstarted',
          },
          { id: 't_5', title: 'Fare capping pilot scoping', state: 'icebox', stateType: 'backlog' },
          {
            id: 't_6',
            title: 'Book the NSU tabling slot',
            state: 'shipped',
            stateType: 'completed',
          },
          { id: 't_7', title: 'Legacy pass reconcile', state: 'dropped', stateType: 'canceled' },
          { id: 't_8', title: 'Orphaned by a workflow edit', state: 'retired' },
        ],
      },
    },
  },
  {
    name: 'work-list-empty',
    tool: 'list_work',
    html: WORK_LIST_HTML,
    input: { orgId: 'org_1' },
    result: { structuredContent: { entity: 'task', items: [] } },
  },
  {
    name: 'plan-populated',
    tool: 'plan_day',
    html: PLAN_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        date: '2026-08-05',
        items: [
          {
            taskId: 't_1',
            title: 'Deep work: service memo',
            status: 'todo',
            startsAt: '2026-08-05T16:00:00Z',
          },
          {
            taskId: 't_2',
            title: 'Campus outreach sync',
            status: 'done',
            startsAt: '2026-08-05T18:30:00Z',
          },
          { taskId: 't_3', title: 'Inbox and follow-ups', status: 'todo' },
        ],
      },
    },
  },
];
