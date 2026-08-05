/**
 * Screenshots of every Docket MCP Apps widget, in every state, at both widths, in both themes.
 *
 * @remarks
 * These widgets render inside someone else's product, under a deny-all CSP, in an opaque origin,
 * driven entirely by postMessage. Nothing about how they look is reachable from a unit test, and
 * the failure mode is not an exception — it is a card that renders wrong in a stranger's transcript
 * and is reported weeks later as a screenshot. That is exactly how Docket shipped a change report
 * in browser-default serif with no background.
 *
 * So the ground truth here is a picture. The spec stands up a fake host that speaks the real
 * handshake — `ui/initialize`, `ui/notifications/initialized`, `tool-input`, `tool-result`, and
 * `size-changed` — and photographs what comes back.
 *
 * It deliberately does NOT drive the dev stack. The widget documents are pure strings with no
 * server behind them, so the suite's usual sign-in fixtures would be pure cost.
 *
 * The `bare` theme cases matter as much as the themed ones: the extension lets a host supply any
 * subset of the style vocabulary or none of it, so the fallbacks are a shipping surface, not a
 * safety net nobody sees.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { CHANGE_REPORT_HTML } from '../../../api/src/mcp/apps/change-report';
import { ENTITY_HTML } from '../../../api/src/mcp/apps/entity';
import { PLAN_HTML } from '../../../api/src/mcp/apps/plan';
import { WORK_LIST_HTML } from '../../../api/src/mcp/apps/work-list';

/** Where the craft review reads its evidence from. */
const SHOT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/design/audits/screenshots/mcp-apps',
);

/** The description edit from the original bug report, verbatim in length and shape. */
const LONG_DESCRIPTION =
  '# Executive Summary The LVBT Campus Engagement Program is our dedicated program for staying ' +
  'in touch with students to build stronger relationships with young people and to leverage ' +
  'their support for lasting change in the valley. # Overview Our Campus Engagement Program ' +
  'consolidates all work to getting college students throughout all of Southern Nevada engaged ' +
  'in transit advocacy and better urbanism. It serves as much of a role in educating students as ' +
  'much as it does attracting them and turning them into a (metaphorical) army for real change. ' +
  '## Motivation There are about 75,000 students in higher education in Southern Nevada across ' +
  'UNLV, CSN, and NSU. Most of these are traditional students in the 18-29 age demographic.';

/** A host palette shaped like a real one: the spec vocabulary, and only part of it. */
const HOST_VARIABLES: Readonly<Record<'light' | 'dark', Readonly<Record<string, string>>>> = {
  light: {
    '--color-background-primary': '#ffffff',
    '--color-background-secondary': '#f7f6f3',
    '--color-text-primary': '#1f1e1c',
    '--color-text-secondary': '#6a6862',
    '--color-border-primary': '#e6e4df',
  },
  dark: {
    '--color-background-primary': '#21201d',
    '--color-background-secondary': '#2b2a26',
    '--color-text-primary': '#f5f4f1',
    '--color-text-secondary': '#a8a59d',
    '--color-border-primary': '#3b3a39',
  },
};

/** One photographable situation: a widget, holding a particular result. */
interface WidgetCase {
  readonly name: string;
  readonly html: string;
  /**
   * The tool the host says produced this card.
   *
   * @remarks
   * Not cosmetic. One change-report document serves `capture`, `update`, `archive` and `organize`,
   * and it reads the tool name out of `hostContext.toolInfo` to decide whether four rows were
   * changed, archived, or filed. Getting this wrong in a fixture would photograph the wrong copy.
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

const CASES: readonly WidgetCase[] = [
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
              { field: 'description', from: LONG_DESCRIPTION, to: 'A shorter, rewritten summary.' },
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
        changeSetId: 'cs_2',
        changes: [
          {
            id: 't_1',
            title: 'Draft the Q3 service change memo',
            fields: [{ field: 'state', from: 'todo', to: 'in_progress' }],
          },
          {
            id: 't_2',
            title: 'Review campus outreach budget',
            fields: [{ field: 'priority', from: 'none', to: 'high' }],
          },
          {
            id: 't_3',
            title: 'Send the RTC coordination follow-up',
            fields: [{ field: 'dueDate', from: 'none', to: '2026-08-14' }],
          },
          {
            id: 't_4',
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
    name: 'change-report-captured',
    tool: 'capture',
    html: CHANGE_REPORT_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        id: 't_9',
        title: 'Chase the RTC coordination reply',
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
    name: 'work-list-populated',
    tool: 'list_work',
    html: WORK_LIST_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        entity: 'task',
        items: [
          {
            id: 't_1',
            title: 'Draft the Q3 service change memo',
            state: 'in_progress',
            stateType: 'started',
          },
          {
            id: 't_2',
            title: 'Review campus outreach budget',
            state: 'todo',
            stateType: 'unstarted',
          },
          {
            id: 't_3',
            title: 'Send the RTC coordination follow-up',
            state: 'todo',
            stateType: 'unstarted',
          },
          { id: 't_4', title: 'Book the NSU tabling slot', state: 'backlog', stateType: 'backlog' },
          { id: 't_5', title: 'Reconcile the UNLV headcount', state: 'todo' },
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
        items: [
          {
            id: 't_1',
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
    name: 'entity-populated',
    tool: 'get',
    html: ENTITY_HTML,
    input: { orgId: 'org_1' },
    result: {
      structuredContent: {
        items: [
          {
            id: 't_1',
            title: 'Draft the Q3 service change memo',
            state: 'doing',
            stateType: 'started',
            // Deliberately a team that renamed everything: the picker has to offer these labels
            // and send these keys, not a hardcoded todo/in_progress/done.
            stateOptions: [
              { key: 'icebox', name: 'Icebox', type: 'backlog' },
              { key: 'queued', name: 'Queued', type: 'unstarted' },
              { key: 'doing', name: 'Doing', type: 'started' },
              { key: 'shipped', name: 'Shipped', type: 'completed' },
              { key: 'dropped', name: 'Dropped', type: 'canceled' },
            ],
            priority: 'high',
            dueDate: '2026-08-14',
            blockedBy: ['t_9'],
            origin: { client: 'Claude', at: '2026-08-01T10:00:00Z' },
          },
        ],
      },
    },
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

/** Which of the runtime's four states this case should settle in. */
function expectedState(testCase: WidgetCase): string {
  if (testCase.cancelled || testCase.result?.['isError']) {
    return 'error';
  }
  return testCase.result ? 'ready' : 'loading';
}

/** The widths a card actually has to survive: a desktop transcript and a phone one. */
const WIDTHS = [
  { name: 'wide', px: 720 },
  { name: 'narrow', px: 320 },
] as const;

/** Whether the host hands over a palette, or leaves the widget on its own fallbacks. */
const PALETTES = ['bare', 'themed'] as const;

const THEMES = ['light', 'dark'] as const;

/**
 * Build a page holding one widget and a fake host that speaks the real protocol.
 *
 * @param testCase - The widget and the result it should be handed.
 * @param theme - The theme the host declares.
 * @param variables - Style variables the host supplies, or null to supply none.
 * @returns a complete HTML document to hand to `page.setContent`.
 */
function harnessPage(
  testCase: WidgetCase,
  theme: 'light' | 'dark',
  variables: Readonly<Record<string, string>> | null,
): string {
  const context = {
    theme,
    displayMode: testCase.fullscreen ? 'fullscreen' : 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    containerDimensions: { maxHeight: 640 },
    locale: 'en-US',
    platform: 'web',
    toolInfo: { tool: { name: testCase.tool } },
    ...(variables ? { styles: { variables } } : {}),
  };

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><style>
  html { color-scheme: light dark; }
  body { margin: 0; padding: 12px; background: light-dark(#ececf0, #131316); }
  iframe { width: 100%; border: 0; display: block; background: transparent; }
</style></head>
<body>
<iframe id="view" sandbox="allow-scripts" srcdoc="${testCase.html.replace(/"/g, '&quot;')}"></iframe>
<script>
const view = document.getElementById('view');
const CONTEXT = ${JSON.stringify(context)};
const INPUT = ${JSON.stringify(testCase.input)};
const RESULT = ${JSON.stringify(testCase.result)};
const CANCELLED = ${JSON.stringify(Boolean(testCase.cancelled))};

window.addEventListener('message', (event) => {
  if (event.source !== view.contentWindow) {
    return;
  }
  const msg = event.data;
  if (!msg || msg.jsonrpc !== '2.0') {
    return;
  }
  const post = (payload) => view.contentWindow.postMessage(payload, '*');

  if (msg.method === 'ui/initialize') {
    post({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2026-01-26',
        hostInfo: { name: 'shot-harness', version: '1.0.0' },
        hostCapabilities: { openLinks: {}, serverTools: {} },
        hostContext: CONTEXT,
      },
    });
    return;
  }
  if (msg.method === 'ui/notifications/initialized') {
    post({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: INPUT } });
    if (CANCELLED) {
      post({ jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled', params: {} });
    } else if (RESULT) {
      post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: Object.assign({ content: [] }, RESULT) });
    }
    return;
  }
  if (msg.method === 'ui/notifications/size-changed') {
    view.style.height = msg.params.height + 'px';
    view.dataset.reportedHeight = String(msg.params.height);
    return;
  }
  if (msg.method === 'ui/request-display-mode') {
    // The spec allows the answer to differ from the request, and requires the host to return the
    // mode it actually applied. This harness always grants, but it must still say so.
    post({ jsonrpc: '2.0', id: msg.id, result: { mode: msg.params.mode } });
    return;
  }
  if (msg.id !== undefined) {
    post({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
</script>
</body>
</html>`;
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

for (const palette of PALETTES) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test.describe(`${palette} · ${theme} · ${width.name}`, () => {
        test.use({ viewport: { width: width.px, height: 900 }, colorScheme: theme });

        for (const testCase of CASES) {
          test(testCase.name, async ({ page }) => {
            await page.setContent(
              harnessPage(testCase, theme, palette === 'themed' ? HOST_VARIABLES[theme] : null),
            );

            const view = page.locator('#view');
            // The widget reports its own height. Waiting on that rather than a timeout is also
            // the assertion that the resize loop runs at all — it is the defect that made every
            // card clip its content, and a missing notification hangs here instead of passing.
            await expect(view).toHaveAttribute('data-reported-height', /^[0-9]+$/);

            const reported = Number(await view.getAttribute('data-reported-height'));
            expect(reported, 'reported its own height').toBeGreaterThan(0);

            const body = view.contentFrame().locator('body');
            // A widget must never scroll inside a transcript, at any width.
            const overflow = await body.evaluate((node) => node.scrollWidth - node.clientWidth);
            expect(overflow, 'horizontal overflow inside the card').toBeLessThanOrEqual(0);

            // Exactly one of loading / stalled / ready / error, and never the old failure mode of
            // a card sitting on a hardcoded headline with nothing behind it.
            await expect(body).toHaveAttribute('data-state', expectedState(testCase));

            // A tool's own error prose never reaches a Docket card: it may be a stack trace, and
            // on a connected third-party server it is attacker-authored.
            await expect(body).not.toContainText('TypeError');

            if (testCase.name === 'work-list-fullscreen') {
              // The expanded list is the only case that shows all five state glyphs at once — the
              // inline cap hides the fifth. Asserting on what rendered, rather than on the markup
              // that produced it, is what makes this catch a glyph that silently draws nothing.
              const glyphs = await body.locator('.glyph').evaluateAll((nodes) =>
                nodes
                  .flatMap((node) => [...node.classList])
                  .filter((name) => name.startsWith('state-'))
                  .sort(),
              );
              expect(glyphs).toEqual([
                'state-backlog',
                'state-canceled',
                'state-completed',
                'state-started',
                'state-started',
                'state-unstarted',
                'state-unstarted',
              ]);
              // The row whose state its team no longer lists draws no glyph at all, because a
              // wrong one is worse than none.
              await expect(body).toContainText('State not recognised');
            }

            // Every control is reachable and says what it is. The rubric's a11y gate asks for
            // keyboard operability and labelled controls, and a card whose only affordance is an
            // unnamed glyph button fails it — which is what the day plan's ticks used to be.
            const controls = body.locator(
              'button:not([hidden]), select:not([hidden]), input:not([hidden])',
            );
            if (testCase.name === 'entity-populated') {
              // Asserting a filtered list is empty passes just as well when the locator matched
              // nothing. This is the case with the most controls, so it is the one that proves the
              // check is looking at something.
              expect(await controls.count()).toBeGreaterThanOrEqual(3);
            }
            const unnamed = await controls.evaluateAll((nodes) =>
              nodes
                .filter((node) => {
                  const label = node.closest('label');
                  const aria = node.getAttribute('aria-label') ?? '';
                  const wrapping = label ? label.textContent : '';
                  return `${aria}${wrapping}${node.textContent}`.trim() === '';
                })
                .map((node) => node.outerHTML.slice(0, 60)),
            );
            expect(unnamed, 'controls with no accessible name').toEqual([]);

            await page.screenshot({
              path: join(SHOT_DIR, `${testCase.name}-${palette}-${theme}-${width.name}.png`),
            });
          });
        }
      });
    }
  }
}
