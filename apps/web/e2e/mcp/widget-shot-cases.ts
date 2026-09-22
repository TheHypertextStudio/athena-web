/**
 * Cases for `widget-shots.spec.ts` that live outside the spec.
 *
 * @remarks
 * The label and template receipts, spread into the spec's list beside the fixtures in
 * `widget-fixtures.ts`. The spec photographs them exactly like its own.
 */
import { CHANGE_REPORT_HTML } from '../../../api/src/mcp/apps/change-report';
import type { WidgetCase } from './widget-fixtures';

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
