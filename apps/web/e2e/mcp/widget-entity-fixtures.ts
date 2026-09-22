/**
 * Widget evidence fixtures: the semantic entity cards.
 *
 * @remarks
 * Each result carries the `_meta` render model the API attaches, built by `entityRenderMeta` from
 * the same Markdown the payload holds, so the photographed card is what a host would receive.
 */
import { entityRenderMeta } from '../../../api/src/mcp/apps/entity-render';
import { entityDocument, ENTITY_HTML } from '../../../api/src/mcp/apps/entity';
import { day, STORED_BRIEF, type WidgetCase } from './widget-fixtures';

type Item = Record<string, unknown>;

/** A read result as the API returns it: the items, what was missing, and the render model. */
function read(
  items: readonly Item[],
  missing: readonly Item[] = [],
  work?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const meta = entityRenderMeta(items, work);
  return { structuredContent: { items, missing }, ...(meta ? { _meta: meta } : {}) };
}

/** A related task as a hydrated read names it. */
function taskRef(id: string, title: string, stateType: string, stateName: string): Item {
  return {
    id,
    title,
    state: stateName.toLowerCase(),
    stateType,
    stateName,
    href: `/orgs/org_1/tasks/${id}`,
  };
}

/** The shape of a big project: how many tasks sit in each state, and in which milestone. */
const WORK_PLAN: readonly (readonly [string, string, number, string | null])[] = [
  ['started', 'In Progress', 12, 'm_1'],
  ['unstarted', 'To do', 30, 'm_1'],
  ['backlog', 'Backlog', 18, 'm_2'],
  ['completed', 'Done', 40, 'm_1'],
];

const PEOPLE = ['Ada Rivera', 'Marisol Vega', 'Sam Okafor', null];

/** A hundred tasks, as the project read's `_meta` index carries them. */
function workIndex(): { tasks: Item[]; total: number } {
  const tasks = WORK_PLAN.flatMap(([stateType, stateName, count, milestoneId]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `w_${stateType}_${index}`,
      title: `${stateName} task ${index + 1} for the campaign week`,
      href: `/orgs/org_1/tasks/w_${stateType}_${index}`,
      stateType,
      stateName,
      milestoneId: index % 3 === 0 ? 'm_2' : milestoneId,
      dueDate: index % 4 === 0 ? null : day((index % 9) - 3),
      assignee: PEOPLE[index % PEOPLE.length] ?? null,
    })),
  );
  return { tasks, total: tasks.length };
}

const PROJECT: Item = {
  id: 'p_1',
  name: 'Week Without Driving 2026',
  summary: null,
  description: STORED_BRIEF,
  status: 'in_progress',
  health: 'on_track',
  targetDate: '2026-10-05T00:00:00.000Z',
  taskCount: 100,
  work: {
    total: 100,
    open: 60,
    byType: { started: 12, unstarted: 30, backlog: 18, completed: 40, canceled: 0, unknown: 0 },
  },
  tasks: [
    { ...taskRef('t_1', 'Book the daily hosts', 'started', 'In Progress'), dueDate: day(-2) },
    {
      ...taskRef('t_2', 'Draft the launch reel script', 'started', 'In Progress'),
      dueDate: day(1),
    },
    { ...taskRef('t_3', 'Order giveaway stickers', 'unstarted', 'To do'), dueDate: day(4) },
    { ...taskRef('t_4', 'Confirm the RTC bus pass donation', 'unstarted', 'To do'), dueDate: null },
    { ...taskRef('t_5', 'Write the recap blog post', 'backlog', 'Backlog'), dueDate: null },
  ],
  milestones: [
    {
      id: 'm_1',
      name: 'Campaign week',
      targetDate: day(6),
      progress: { completed: 30, total: 58 },
    },
    {
      id: 'm_2',
      name: 'Recap published',
      targetDate: day(20),
      progress: { completed: 10, total: 42 },
    },
    {
      id: 'm_3',
      name: 'Partner toolkit',
      targetDate: day(-4),
      progress: { completed: 3, total: 5 },
    },
  ],
  initiatives: [
    { id: 'i_1', name: 'Transit access', health: 'on_track', href: '/orgs/org_1/initiatives/i_1' },
  ],
  latestUpdate: {
    id: 'u_1',
    health: 'at_risk',
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    author: { displayName: 'Marisol Vega' },
    href: '/orgs/org_1/search?kind=update&id=u_1',
    body: '## This week\n\n- Hosts **confirmed** for 5 of 7 days\n- Sticker order placed &amp; paid\n\n## Next\n\nLock the giveaway rules with RTC.',
  },
  href: '/orgs/org_1/projects/p_1',
};

/** The project read with its hundred-task index in `_meta`. */
const PROJECT_READ = read([PROJECT], [], { p_1: workIndex() });

const BATCH: readonly Item[] = [
  PROJECT,
  {
    id: 'p_2',
    name: 'Campus Engagement Program',
    description: '# Executive Summary\n\nOur dedicated program for staying in touch with students.',
    status: 'in_progress',
    health: 'at_risk',
    taskCount: 7,
    href: '/orgs/org_1/projects/p_2',
  },
  {
    id: 'p_3',
    name: 'Bus Buddies',
    summary: 'Pairs riders with reliable transit guidance.',
    status: 'planned',
    taskCount: 3,
    href: '/orgs/org_1/projects/p_3',
  },
];

const TASK: Item = {
  id: 't_1',
  href: '/orgs/org_1/tasks/t_1',
  title: 'Book the daily hosts',
  description:
    '## Checklist\n\n- [x] Monday — Ada\n- [ ] Tuesday\n- [ ] Wednesday\n\nSee [the roster](https://example.com/roster) &amp; confirm by **Friday**.',
  state: 'doing',
  stateType: 'started',
  // A team that renamed everything: the picker offers these labels and sends these keys.
  stateOptions: [
    { key: 'icebox', name: 'Icebox', type: 'backlog' },
    { key: 'queued', name: 'Queued', type: 'unstarted' },
    { key: 'doing', name: 'Doing', type: 'started' },
    { key: 'shipped', name: 'Shipped', type: 'completed' },
    { key: 'dropped', name: 'Dropped', type: 'canceled' },
  ],
  priority: 'high',
  dueDate: day(3),
  blockedBy: [taskRef('t_9', 'Confirm the host roster with RTC', 'unstarted', 'Queued')],
  blocking: [],
  subtasks: [
    taskRef('t_10', 'Email the Monday host', 'completed', 'Shipped'),
    taskRef('t_11', 'Email the Tuesday host', 'started', 'Doing'),
  ],
};

const SUBJECT = {
  type: 'project',
  id: 'p_1',
  name: 'Week Without Driving 2026',
  href: '/orgs/org_1/projects/p_1',
};

/** One case per readable type, with the richest realistic payload each carries. */
const READ_CASES: readonly WidgetCase[] = [
  {
    name: 'entity-task',
    tool: 'get_tasks',
    html: entityDocument('task'),
    input: { orgId: 'org_1' },
    result: read([TASK]),
  },
  {
    name: 'entity-project',
    tool: 'get_projects',
    html: entityDocument('project'),
    input: { orgId: 'org_1' },
    result: PROJECT_READ,
  },
  {
    // A host with less room than the card: cut to its height, with a pinned way into fullscreen.
    name: 'entity-project-tight-host',
    tool: 'get_projects',
    html: entityDocument('project'),
    input: { orgId: 'org_1' },
    maxHeight: 320,
    result: PROJECT_READ,
  },
  {
    // Browse all: the Tasks view with every open task grouped by state.
    name: 'entity-project-tasks',
    tool: 'get_projects',
    html: entityDocument('project'),
    input: { orgId: 'org_1' },
    click: 'Browse all',
    result: PROJECT_READ,
  },
  {
    // The next milestone's chip opens the Tasks view filtered to that milestone's tasks.
    name: 'entity-project-milestone',
    tool: 'get_projects',
    html: entityDocument('project'),
    input: { orgId: 'org_1' },
    click: 'Show the tasks in Campaign week',
    result: PROJECT_READ,
  },
  {
    name: 'entity-projects-batch',
    tool: 'get_projects',
    html: entityDocument('project'),
    input: { orgId: 'org_1' },
    result: read(BATCH, [{ ref: 'Old program', reason: 'not_found' }]),
  },
  {
    name: 'entity-legacy-projects-batch',
    tool: 'get',
    html: ENTITY_HTML,
    input: { orgId: 'org_1', type: 'project' },
    result: read(BATCH),
  },
  {
    name: 'entity-program',
    tool: 'get_programs',
    html: entityDocument('program'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'pg_1',
        name: 'Community access',
        summary: 'Practical access to transit for every rider.',
        description: STORED_BRIEF,
        status: 'active',
        health: 'on_track',
        rollup: { projects: 3, tasks: 22 },
        projects: [
          {
            id: 'p_1',
            name: 'Week Without Driving 2026',
            health: 'on_track',
            href: '/orgs/org_1/projects/p_1',
          },
          { id: 'p_3', name: 'Bus Buddies', health: 'off_track', href: '/orgs/org_1/projects/p_3' },
        ],
        initiatives: [{ id: 'i_1', name: 'Transit access', href: '/orgs/org_1/initiatives/i_1' }],
        latestUpdate: {
          id: 'u_2',
          body: 'The program is on schedule.',
          createdAt: '2026-09-18T15:00:00.000Z',
        },
        href: '/orgs/org_1/programs/pg_1',
      },
    ]),
  },
  {
    name: 'entity-initiative',
    tool: 'get_initiatives',
    html: entityDocument('initiative'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'i_1',
        name: 'Transit access',
        summary: 'A city where everyone can get where they need to go.',
        status: 'active',
        health: 'on_track',
        targetDate: '2027-01-01',
        projects: [
          {
            id: 'p_1',
            name: 'Week Without Driving 2026',
            status: 'in_progress',
            health: 'on_track',
            href: '/orgs/org_1/projects/p_1',
          },
        ],
        programs: [
          {
            id: 'pg_1',
            name: 'Community access',
            health: 'at_risk',
            href: '/orgs/org_1/programs/pg_1',
          },
        ],
        href: '/orgs/org_1/initiatives/i_1',
      },
    ]),
  },
  {
    name: 'entity-cycle',
    tool: 'get_cycles',
    html: entityDocument('cycle'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'c_1',
        displayName: 'Sep 21 – 27',
        status: 'active',
        startsAt: '2026-09-21',
        endsAt: '2026-09-27',
        tasks: [
          taskRef('t_1', 'Publish the volunteer guide', 'started', 'In Progress'),
          taskRef('t_2', 'Book the NSU tabling slot', 'unstarted', 'To do'),
        ],
        href: '/orgs/org_1/cycles/c_1',
      },
    ]),
  },
  {
    name: 'entity-team',
    tool: 'get_teams',
    html: entityDocument('team'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'tm_1',
        name: 'Programs',
        description: 'Runs public programs.',
        triageEnabled: true,
        workflowStates: [
          { key: 'todo', name: 'Ready', type: 'unstarted' },
          { key: 'doing', name: 'Doing', type: 'started' },
          { key: 'done', name: 'Done', type: 'completed' },
        ],
        members: [
          { id: 'a_1', displayName: 'Ada Rivera' },
          { id: 'a_2', displayName: 'Marisol Vega' },
        ],
        href: '/orgs/org_1/teams',
      },
    ]),
  },
  {
    name: 'entity-update',
    tool: 'get_updates',
    html: entityDocument('update'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'u_1',
        subject: SUBJECT,
        body: '## This week\n\n- Hosts **confirmed** for 5 of 7 days\n- Sticker order placed &amp; paid\n\n## Next\n\nLock the giveaway rules with RTC before *Friday*.',
        health: 'at_risk',
        createdAt: '2026-09-21T15:00:00.000Z',
        author: { id: 'a_1', displayName: 'Marisol Vega' },
        href: '/orgs/org_1/search?kind=update&id=u_1',
      },
    ]),
  },
  {
    name: 'entity-comment',
    tool: 'get_comments',
    html: entityDocument('comment'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'cm_1',
        subject: {
          type: 'task',
          id: 't_1',
          name: 'Book the daily hosts',
          href: '/orgs/org_1/tasks/t_1',
        },
        body: 'The library can host **Day 8**. See [the room booking](https://example.com/rooms).',
        createdAt: '2026-09-20T12:00:00Z',
        editedAt: '2026-09-20T13:00:00Z',
        author: { id: 'a_1', displayName: 'Marisol Vega' },
        href: '/orgs/org_1/search?kind=comment&id=cm_1',
      },
    ]),
  },
  {
    name: 'entity-session',
    tool: 'get_sessions',
    html: entityDocument('session'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 's_1',
        status: 'waiting',
        trigger: 'manual',
        startedAt: '2026-09-21T12:00:00Z',
        agent: { id: 'ag_1', displayName: 'Athena' },
        task: { id: 't_1', title: 'Publish the volunteer guide' },
        activities: [
          { id: 'a_1', type: 'thought', body: { text: 'Reading the draft and the host roster.' } },
          { id: 'a_2', type: 'message', body: { text: 'Waiting for the final venue notes.' } },
        ],
        href: '/orgs/org_1/sessions/s_1',
      },
    ]),
  },
  {
    name: 'entity-agent',
    tool: 'get_agents',
    html: entityDocument('agent'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'ag_1',
        displayName: 'Athena',
        guidance:
          '- Keep riders informed about **service changes**\n- Never post on social media without approval',
        approvalPolicy: 'act_with_approval',
        connection: { protocol: 'mcp' },
        href: '/orgs/org_1/agents',
      },
    ]),
  },
  {
    name: 'entity-view',
    tool: 'get_views',
    html: entityDocument('view'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'v_1',
        name: 'Volunteer follow-up',
        scope: 'organization',
        grouping: 'project',
        href: '/orgs/org_1/views?viewId=v_1',
      },
    ]),
  },
  {
    name: 'entity-organization',
    tool: 'get_organizations',
    html: entityDocument('org'),
    input: { orgId: 'org_1' },
    result: read([
      {
        id: 'org_1',
        name: 'Las Vegans for Transit',
        counts: { teams: 3, projects: 7, programs: 2 },
        href: '/orgs/org_1',
      },
    ]),
  },
];

/** The cards whose header offers "Show everything". */
const EXPANDABLE = new Set([
  'entity-task',
  'entity-project',
  'entity-program',
  'entity-initiative',
  'entity-cycle',
  'entity-update',
  'entity-comment',
]);

/**
 * Every read card, then each expandable card again after pressing "Show everything", so the inline
 * glance and what it expands into are photographed side by side.
 */
export const ENTITY_CASES: readonly WidgetCase[] = [
  ...READ_CASES,
  ...READ_CASES.filter((testCase) => EXPANDABLE.has(testCase.name)).map((testCase) => ({
    ...testCase,
    name: `${testCase.name}-expanded`,
    click: 'Show everything',
  })),
];
