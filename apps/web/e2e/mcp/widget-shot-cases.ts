/**
 * Cases for `widget-shots.spec.ts` that live outside the spec.
 *
 * @remarks
 * The spec is pinned at its size in the complexity ledger, so cases for newer tools are declared
 * here and spread into its list. The spec photographs them exactly like its own.
 */
import { CHANGE_REPORT_HTML } from '../../../api/src/mcp/apps/change-report';

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
}

/** The change-report states for label and template writes. */
export const CATALOG_CASES: readonly WidgetCase[] = [
  {
    // One define_labels call that made a group, filled it, restyled an older label, and was refused
    // one restyle. Each row names its own kind and where it lives, because the call mixes kinds.
    name: 'change-report-labels-defined',
    tool: 'define_labels',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        changed: 3,
        listHref: '/orgs/org_1/settings/labels',
        changeSetId: 'cs_7',
        changes: [
          {
            kind: 'label_group',
            id: 'lg_1',
            title: 'Severity',
            href: '/orgs/org_1/settings/labels',
            note: 'New · Group · one at a time · Core',
            matched: false,
            fields: [],
          },
          {
            kind: 'label',
            id: 'l_1',
            title: 'Blocker',
            href: '/orgs/org_1/settings/labels',
            note: 'New · Severity · Core',
            matched: false,
            fields: [],
          },
          {
            kind: 'label',
            id: 'l_2',
            title: 'Defect',
            href: '/orgs/org_1/settings/labels',
            note: 'No group · Workspace',
            matched: false,
            fields: [
              { field: 'name', from: 'bug', to: 'Defect' },
              { field: 'color', from: 'blue', to: 'coral' },
            ],
          },
        ],
        skipped: [
          {
            kind: 'label',
            id: null,
            title: 'Design review',
            reason: 'not_permitted',
            detail: 'forbidden: Forbidden',
          },
        ],
      },
    },
  },
  {
    name: 'change-report-template-edited',
    tool: 'define_template',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        changed: 1,
        listHref: '/orgs/org_1/settings/templates',
        changeSetId: 'cs_8',
        changes: [
          {
            kind: 'template',
            id: 'tpl_1',
            title: 'Bug report',
            href: '/orgs/org_1/settings/templates',
            note: 'Task template · Workspace',
            matched: false,
            fields: [
              { field: 'description', from: 'none', to: 'For anything broken' },
              { field: 'body', from: 'none', to: '## Steps to reproduce' },
              { field: 'labels', from: 'none', to: 'Defect' },
              { field: 'priority', from: 'low', to: 'urgent' },
            ],
          },
        ],
        skipped: [],
      },
    },
  },
  {
    // `update` with set.labels: an exclusive swap on one row, and a row outside the label's team.
    name: 'change-report-labels-applied',
    tool: 'update',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        matched: 3,
        changed: 2,
        entity: 'task',
        listHref: '/orgs/org_1/tasks',
        changeSetId: 'cs_9',
        changes: [
          {
            id: 't_1',
            href: '/orgs/org_1/tasks/t_1',
            title: 'Crash when saving a draft route',
            fields: [{ field: 'labels', from: 'none', to: 'Blocker' }],
          },
          {
            id: 't_2',
            href: '/orgs/org_1/tasks/t_2',
            title: 'Stop times drift after midnight',
            fields: [{ field: 'labels', from: 'Defect, Minor', to: 'Blocker, Defect' }],
          },
        ],
        skipped: [
          {
            id: 't_3',
            title: 'Refresh the brand palette',
            reason: 'label_out_of_scope',
          },
        ],
      },
    },
  },
];
