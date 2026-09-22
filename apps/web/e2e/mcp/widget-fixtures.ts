/**
 * Widget evidence fixtures: the shared case shape, and the write reports.
 *
 * @remarks
 * Every payload here is the shape its tool really returns, and every authored field is Markdown in
 * the shape the editor stores it — newlines, headings, lists, and `&amp;` — because a fixture that
 * holds only one-line summaries photographs a card real data never produces. That is how the
 * 2026-08-05 review scored a project card that showed its brief as raw Markdown in Claude.
 *
 * Render models are built by the server's own functions, never written by hand, so a fixture cannot
 * drift from what the API sends.
 */
import { shiftDate, todayDate } from '../helpers/calendar-fixtures';

import { markdownToPlainText } from '../../../api/src/content/markdown-links';
import { CHANGE_REPORT_HTML } from '../../../api/src/mcp/apps/change-report';
import { wordRewrite } from '../../../api/src/mcp/apps/text-diff';

/** One photographable situation: a widget, holding a particular result. */
export interface WidgetCase {
  readonly name: string;
  readonly html: string;
  /**
   * The tool the host says produced this card.
   *
   * @remarks
   * Not cosmetic. One change-report document serves `capture`, `update`, `archive`, `organize`,
   * `define_labels` and `define_template`, and it reads the tool name out of
   * `hostContext.toolInfo` to decide whether rows were changed, archived, filed, or saved. Getting
   * this wrong in a fixture would photograph the wrong copy.
   */
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** `null` means the host never delivers a result, which is the loading state. */
  readonly result: Readonly<Record<string, unknown>> | null;
  /** Send `tool-cancelled` instead of `tool-result`, the way a host does on an abandoned call. */
  readonly cancelled?: boolean;
  /** Start the view fullscreen, so the expanded layout is photographed rather than assumed. */
  readonly fullscreen?: boolean;
  /** The accessible name of a control to press before the photograph, to reach a view by use. */
  readonly click?: string;
  /** The host's height limit for an inline card, when it gives one smaller than the card. */
  readonly maxHeight?: number;
  /** The page the host returns when the card calls `list_work` for more. */
  readonly nextPage?: Readonly<Record<string, unknown>>;
}

/** Relative rather than fixed, so "3 days late" stays three days late as the fixture ages. */
export function day(offset: number): string {
  return shiftDate(todayDate(), offset);
}

/** A project brief exactly as the editor stores one, from the live report that started this. */
export const STORED_BRIEF = [
  '# Executive Summary',
  '',
  "LVBT's week without driving is a short media campaign to show what it's like to not have a car for daily activities. For our first iteration, we will focus on creating a social media presence.",
  '',
  '# Overview',
  '',
  'Week Without Driving (weekwithoutdriving.org) is a national initiative to improve walkability by getting people to step out of their comfort zone.',
  '',
  '## Motivation',
  '',
  'This project aligns with the following strategic priorities:',
  '',
  '- Priority 3: Build a Community of Urbanists and Transit Enthusiasts',
  '  - A campaign focused on *not* driving is urbanist- and transit-coded.',
  '- Priority 5: Maintain Strategic Institutional &amp; Agency Coalitions',
  '',
  '## Activities',
  '',
  '### Giveaway',
  '',
  'We are going to give away a one-month RTC bus pass, some LVBT stickers, and potentially a T-shirt.',
].join('\n');

const REWRITTEN_BRIEF = STORED_BRIEF.replace('short media', 'week-long media');

/** The render `_meta` an `update` sends for a rewrite of {@link STORED_BRIEF}. */
function rewriteMeta(id: string): Record<string, unknown> {
  const rewrite = wordRewrite(
    markdownToPlainText(STORED_BRIEF, 100_000),
    markdownToPlainText(REWRITTEN_BRIEF, 100_000),
  );
  return { 'docket/render': { changes: { [id]: { description: { rewrite } } } } };
}

/** Nine top-level tasks filed into one existing project, most with subtasks: the live report. */
function filedPlan(): Record<string, unknown>[] {
  const container = {
    kind: 'project',
    id: 'p_1',
    title: 'Week Without Driving 2026',
    href: '/orgs/org_1/projects/p_1',
  };
  const roots: readonly (readonly [string, readonly string[]])[] = [
    [
      'Build a partner toolkit',
      ['Write sample captions', 'Write the staff email', 'Export flyer files'],
    ],
    ['Publish a first-time bus rider guide on lvwwd.org', []],
    [
      'Log giveaway entries every day of the week',
      ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6', 'Oct 7', 'Oct 8'].map(
        (date) => `Log entries for ${date}`,
      ),
    ],
    ['Pick and announce the giveaway winner', []],
    ['Buy giveaway prizes', ['Buy a 1-month RTC pass', 'Order LVBT stickers']],
    ['Pitch the week to Las Vegas media', ['Draft the press release', 'Send pitches']],
    ['Write the recap blog post', []],
    ['Produce the recap video', ['Collect daily clips', 'Edit the recap']],
    ['Find the Day 8 host', []],
  ];
  return roots.flatMap(([title, children], index) => [
    {
      ref: `r${index}`,
      kind: 'task',
      id: `tr${index}`,
      title,
      href: `/orgs/org_1/tasks/tr${index}`,
      created: index !== 3,
      container,
    },
    ...children.map((child, childIndex) => ({
      ref: `r${index}c${childIndex}`,
      kind: 'task',
      id: `tc${index}_${childIndex}`,
      title: child,
      href: `/orgs/org_1/tasks/tc${index}_${childIndex}`,
      parent: `r${index}`,
      created: true,
    })),
  ]);
}

/** The write reports: capture, update, archive, and organize. */
export const REPORT_CASES: readonly WidgetCase[] = [
  {
    name: 'change-report-loading',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: null,
  },
  {
    name: 'change-report-long-diff',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        changed: 1,
        changeSetId: 'cs_1',
        changes: [
          {
            id: 't_1',
            title: 'LVBT Campus Engagement Program',
            fields: [
              { field: 'description', from: STORED_BRIEF, to: 'A shorter, rewritten summary.' },
            ],
          },
        ],
      },
    },
  },
  {
    name: 'change-report-bulk-with-skips',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        changed: 4,
        entity: 'task',
        listHref: '/orgs/org_1/tasks',
        changeSetId: 'cs_2',
        changes: [
          {
            id: 't_1',
            href: '/orgs/org_1/tasks/t_1',
            title: 'Draft the Q3 service change memo',
            fields: [{ field: 'state', from: 'todo', to: 'in_progress' }],
          },
          {
            id: 't_2',
            href: '/orgs/org_1/tasks/t_2',
            title: 'Review campus outreach budget',
            fields: [{ field: 'priority', from: 'none', to: 'high' }],
          },
          {
            id: 't_3',
            href: '/orgs/org_1/tasks/t_3',
            title: 'Send the RTC coordination follow-up',
            fields: [{ field: 'dueDate', from: 'none', to: '2026-08-14' }],
          },
          {
            id: 't_4',
            href: '/orgs/org_1/tasks/t_4',
            title: 'Book the NSU tabling slot',
            fields: [{ field: 'state', from: 'todo', to: 'done' }],
          },
        ],
        skipped: [
          { id: 't_5', title: 'Board packet — September', reason: 'not_permitted' },
          { id: 't_6', title: 'Archived pilot retro', reason: 'already_archived' },
        ],
      },
    },
  },
  {
    // A rename, which is the most common single edit and the one the card handled worst: it printed
    // the new title in the row and again as the right-hand side of the diff, truncating the row's
    // copy to make room for the duplicate.
    name: 'change-report-renamed',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        changed: 1,
        entity: 'task',
        listHref: '/orgs/org_1/tasks',
        changeSetId: 'cs_9',
        changes: [
          {
            id: 't_1',
            href: '/orgs/org_1/tasks/t_1',
            title: 'Write down what to change for Dallas',
            fields: [
              {
                field: 'title',
                from: 'Write down what worked, for the Dallas version',
                to: 'Write down what to change for Dallas',
              },
              { field: 'priority', from: 'none', to: 'high' },
              { field: 'dueDate', from: 'none', to: '2026-09-12' },
            ],
          },
        ],
      },
    },
  },
  {
    name: 'change-report-nothing-changed',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: { structuredContent: { changed: 0, changes: [] } },
  },
  {
    // Same document, same payload shape, different tool. The headline and the skipped heading both
    // have to follow the verb, or one card silently reports an archive as an edit.
    name: 'change-report-archived',
    tool: 'archive',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        changed: 2,
        changeSetId: 'cs_3',
        changes: [
          { id: 't_1', title: 'Legacy pass reconciliation', fields: [] },
          { id: 't_2', title: 'Pilot retro notes', fields: [] },
        ],
        skipped: [{ id: 't_3', title: 'Board packet — September', reason: 'already_archived' }],
      },
    },
  },
  {
    // The one case nothing photographed, and the one that shipped wrong: `organize` returns
    // `placed` rather than `changes`, and the card rendered each row's `ref` — the handle the model
    // invented so children could name a parent in one call — as its title. Four kinds in one call,
    // none of them carrying a diff, so this is also the case where a row is only a name.
    name: 'change-report-organized',
    tool: 'organize',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        created: 4,
        matched: 1,
        changeSetId: 'cs_5',
        placed: [
          {
            ref: 'init',
            kind: 'initiative',
            title: 'Q3 transit access',
            id: 'i_1',
            href: '/orgs/org_1/initiatives/i_1',
            created: true,
          },
          {
            ref: 'proj',
            kind: 'project',
            title: 'Campus tabling',
            parent: 'init',
            id: 'p_1',
            href: '/orgs/org_1/projects/p_1',
            created: true,
          },
          {
            ref: 't-date',
            kind: 'task',
            title: 'Pick the NSU date',
            parent: 'proj',
            id: 't_1',
            href: '/orgs/org_1/tasks/t_1',
            created: true,
          },
          {
            ref: 't-rules',
            kind: 'task',
            title: 'Read the tabling rules',
            parent: 'proj',
            id: 't_2',
            href: '/orgs/org_1/tasks/t_2',
            created: true,
          },
          {
            ref: 'ppt',
            kind: 'task',
            title: 'Build the deck',
            parent: 'proj',
            id: 't_3',
            href: '/orgs/org_1/tasks/t_3',
            created: false,
          },
        ],
      },
    },
  },
  {
    name: 'change-report-captured',
    tool: 'capture',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        items: [
          {
            id: 't_9',
            title: 'Chase the RTC coordination reply',
            href: '/orgs/org_1/tasks/t_9',
            state: 'Backlog',
            teamId: 'team_1',
          },
        ],
        listHref: '/orgs/org_1/tasks',
        changeSetId: 'cs_4',
      },
    },
  },
  {
    name: 'change-report-failed',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      isError: true,
      content: [{ type: 'text', text: 'TypeError: cannot read x of undefined' }],
    },
  },
  {
    name: 'change-report-cancelled',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: null,
    cancelled: true,
  },
  {
    name: 'change-report-brief-rewrite',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        changed: 1,
        entity: 'project',
        changeSetId: 'cs_6',
        changes: [
          {
            id: 'p_1',
            href: '/orgs/org_1/projects/p_1',
            title: 'Week Without Driving 2026',
            fields: [
              {
                field: 'description',
                from: STORED_BRIEF.slice(0, 199),
                to: REWRITTEN_BRIEF.slice(0, 199),
              },
              { field: 'leadId', from: 'none', to: 'a_2' },
            ],
          },
        ],
      },
      _meta: {
        'docket/render': {
          changes: {
            p_1: {
              ...(rewriteMeta('p_1')['docket/render'] as { changes: { p_1: object } }).changes.p_1,
              leadId: { from: 'none', to: 'Ada Rivera' },
            },
          },
        },
      },
    },
  },
  {
    name: 'change-report-filed-plan',
    tool: 'organize',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: { placed: filedPlan(), created: 29, matched: 1, changeSetId: 'cs_7' },
    },
  },
  {
    name: 'change-report-filed-plan-fullscreen',
    tool: 'organize',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    fullscreen: true,
    result: {
      structuredContent: { placed: filedPlan(), created: 29, matched: 1, changeSetId: 'cs_7' },
    },
  },
];
