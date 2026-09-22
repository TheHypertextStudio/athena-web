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
import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';

import { ENTITY_CASES } from './widget-entity-fixtures';
import { REPORT_CASES, type WidgetCase } from './widget-fixtures';
import { LIST_CASES } from './widget-list-fixtures';
import { CATALOG_CASES } from './widget-shot-cases';

declare global {
  interface Window {
    /** Every link the card asked the harness host to open. */
    receivedLinks: string[];
    /** Grow the host's frame to a height, for photographing a whole fullscreen card. */
    growFrame(height: number): void;
  }
}

/** Where the craft review reads its evidence from. */
const SHOT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/design/audits/screenshots/mcp-apps',
);

/**
 * A host palette shaped like Claude's: the spec vocabulary a real client supplies — colours, radii,
 * and the type scale — so the themed captures show a card the way it looks native in that client.
 */
const HOST_VARIABLES: Readonly<Record<'light' | 'dark', Readonly<Record<string, string>>>> = {
  light: {
    '--color-background-primary': '#ffffff',
    '--color-background-secondary': '#f5f4ef',
    '--color-background-tertiary': '#ecebe4',
    '--color-text-primary': '#1f1e1d',
    '--color-text-secondary': '#6b6a66',
    '--color-text-tertiary': '#8a8984',
    '--color-border-primary': '#e5e3dc',
    '--font-text-md-size': '1rem',
    '--font-text-md-line-height': '1.5',
    '--font-text-sm-size': '0.875rem',
    '--font-text-sm-line-height': '1.45',
    '--font-heading-sm-size': '1.1875rem',
    '--border-radius-md': '8px',
    '--border-radius-lg': '12px',
  },
  dark: {
    '--color-background-primary': '#262624',
    '--color-background-secondary': '#30302e',
    '--color-background-tertiary': '#3a3a37',
    '--color-text-primary': '#f5f4ef',
    '--color-text-secondary': '#a6a39b',
    '--color-text-tertiary': '#8f8d86',
    '--color-border-primary': '#3d3d3a',
    '--font-text-md-size': '1rem',
    '--font-text-md-line-height': '1.5',
    '--font-text-sm-size': '0.875rem',
    '--font-text-sm-line-height': '1.45',
    '--font-heading-sm-size': '1.1875rem',
    '--border-radius-md': '8px',
    '--border-radius-lg': '12px',
  },
};

/** Every case the suite photographs. */
const CASES: readonly WidgetCase[] = [
  ...REPORT_CASES,
  ...CATALOG_CASES,
  ...LIST_CASES,
  ...ENTITY_CASES,
];

/** Markdown that reached a reader as characters instead of structure. */
const RAW_MARKDOWN = /(^|\s)#{1,6}\s|\*\*|&amp;|\]\(/;

/**
 * The tallest an inline card may be, by frame width. An inline card sits in a chat transcript next
 * to the model's own answer, so it is a glance: what does not fit goes to fullscreen, or to Docket.
 */
const INLINE_BUDGET_PX: Readonly<Record<string, number>> = { wide: 520, narrow: 680 };

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
    // A fullscreen host hands the view a fixed height and scrolls nothing itself; an inline one
    // lets the card grow to what it reports.
    containerDimensions: testCase.fullscreen
      ? { height: 876 }
      : { maxHeight: testCase.maxHeight ?? 4000 },
    locale: 'en-US',
    platform: 'web',
    toolInfo: { tool: { name: testCase.tool } },
    ...(variables ? { styles: { variables } } : {}),
  };

  // Every Docket widget declares \`prefersBorder: true\`, so this host draws the frame the way a
  // client does: its own border and background around the app, from its own palette.
  const frame = variables ?? {};
  const border = frame['--color-border-primary'] ?? 'light-dark(#e4e4e7, #3a3a44)';
  const surface = frame['--color-background-primary'] ?? 'light-dark(#ffffff, #1c1c20)';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><style>
  html { color-scheme: ${theme}; }
  body { margin: 0; padding: 12px; background: light-dark(#f4f3ee, #1a1a18); }
  iframe { width: 100%; display: block; box-sizing: border-box; border: 1px solid ${border}; border-radius: 14px; background: ${surface}; }
</style></head>
<body>
<iframe id="view" sandbox="allow-scripts" srcdoc="${testCase.html.replace(/"/g, '&quot;')}"></iframe>
<script>
const view = document.getElementById('view');
const CONTEXT = ${JSON.stringify(context)};
const INPUT = ${JSON.stringify(testCase.input)};
const RESULT = ${JSON.stringify(testCase.result)};
const CANCELLED = ${JSON.stringify(Boolean(testCase.cancelled))};
const NEXT_PAGE = ${JSON.stringify(testCase.nextPage ?? null)};
window.receivedLinks = [];
// Fullscreen scrolls inside the host's frame. For the photograph, the frame grows to the whole card,
// so everything "Show everything" shows is on one image.
window.growFrame = (height) => {
  CONTEXT.containerDimensions = { height };
  view.style.height = height + 'px';
};

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
    view.style.height = (CONTEXT.containerDimensions.height || msg.params.height) + 'px';
    view.dataset.reportedHeight = String(msg.params.height);
    return;
  }
  if (msg.method === 'ui/request-display-mode') {
    // The spec allows the answer to differ from the request, and requires the host to return the
    // mode it actually applied. This harness always grants, but it must still say so, and a
    // fullscreen host hands the view the whole viewport the way it does for a card that starts there.
    if (msg.params.mode === 'fullscreen') {
      CONTEXT.containerDimensions = { height: 876 };
      view.style.height = '876px';
      post({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { containerDimensions: { height: 876 } } });
    }
    post({ jsonrpc: '2.0', id: msg.id, result: { mode: msg.params.mode } });
    return;
  }
  if (msg.method === 'ui/open-link') {
    window.receivedLinks.push(msg.params.url);
    post({ jsonrpc: '2.0', id: msg.id, result: {} });
    return;
  }
  if (msg.method === 'tools/call' && NEXT_PAGE) {
    post({ jsonrpc: '2.0', id: msg.id, result: { content: [], structuredContent: NEXT_PAGE } });
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

/**
 * The structure every ready card must have, whatever it shows.
 *
 * @remarks
 * These are the failures the 2026-09-22 review found in production, each one a card that rendered
 * without error and read as a wall of text: authored Markdown shown as characters, a border drawn
 * where the design system uses tonal steps, a row with nothing at its left edge for the eye to run
 * down, and an inline section tall enough to push everything after it out of view.
 */
async function expectStructure(body: Locator, testCase: WidgetCase, width: string): Promise<void> {
  if ((await body.getAttribute('data-state')) !== 'ready') return;
  const text = await body.evaluate((node) => (node as HTMLElement).innerText);
  expect(text, 'raw Markdown on the card').not.toMatch(RAW_MARKDOWN);
  const bordered = await body.evaluate((node) =>
    [...node.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const sides = [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ];
        return (
          box.width > 0 &&
          style.borderStyle !== 'none' &&
          sides.some((side) => parseFloat(side) > 0)
        );
      })
      .map((element) => element.outerHTML.slice(0, 60)),
  );
  expect(bordered, 'elements drawing a border').toEqual([]);
  const unanchored = await body
    .locator('.row')
    .evaluateAll((rows) =>
      rows
        .filter((row) => !row.querySelector('.row-anchor > *'))
        .map((row) => row.textContent.slice(0, 40)),
    );
  expect(unanchored, 'rows without a leading anchor').toEqual([]);
  const inline = (await body.getAttribute('data-display-mode')) !== 'fullscreen';
  if (inline) {
    // The card sits in a conversation beside the model's answer: a glance, never a page.
    const reported = await body.evaluate((node) => node.scrollHeight);
    const budget = Math.min(INLINE_BUDGET_PX[width] ?? 520, testCase.maxHeight ?? Infinity);
    expect(reported, 'inline card height').toBeLessThanOrEqual(budget);
  }
}

/** Every row that names something opens it, and in the order the card lists them. */
async function expectEveryRowOpens(
  page: Page,
  frame: FrameLocator,
  hrefs: readonly string[],
): Promise<void> {
  const rows = frame.locator('.row[role="link"]');
  expect(await rows.count()).toBe(hrefs.length);
  for (const row of await rows.all()) await row.click({ position: { x: 24, y: 12 } });
  await expect.poll(() => page.evaluate(() => window.receivedLinks)).toEqual([...hrefs]);
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
              // Derived from the fixture rather than pinned to a literal list, so extending the
              // fixture does not fail this for a reason that has nothing to do with glyphs, while
              // a glyph that fails to draw still shows up as a missing entry.
              const fixtureItems = (
                testCase.result?.['structuredContent'] as { items: { stateType?: string }[] }
              ).items;
              expect(glyphs).toEqual(
                fixtureItems
                  .filter((item) => item.stateType)
                  .map((item) => `state-${String(item.stateType)}`)
                  .sort(),
              );
              // The row whose state its team no longer lists draws no glyph at all, because a
              // wrong one is worse than none.
              await expect(body).toContainText('State not recognised');
            }

            if (testCase.click) {
              await body.getByRole('button', { name: testCase.click }).first().click();
              await expect(body).toHaveAttribute('data-display-mode', 'fullscreen');
            }
            if (testCase.maxHeight !== undefined) {
              // A host with less room than the card: cut to fit, with the way into fullscreen.
              await expect(
                body.getByRole('button', { name: 'Show everything' }).last(),
              ).toBeVisible();
            }
            if (testCase.nextPage) {
              const before = await body.locator('.row').count();
              await body.getByRole('button', { name: 'Load more' }).click();
              await expect.poll(() => body.locator('.row').count()).toBeGreaterThan(before);
            }
            await expectStructure(body, testCase, width.name);

            // Every control is reachable and says what it is. The rubric's a11y gate asks for
            // keyboard operability and labelled controls, and a card whose only affordance is an
            // unnamed glyph button fails it — which is what the day plan's ticks used to be.
            const controls = body.locator(
              'button:not([hidden]), select:not([hidden]), input:not([hidden])',
            );
            if (testCase.name === 'entity-task') {
              // Asserting a filtered list is empty passes just as well when the locator matched
              // nothing. This is the case with the most controls, so it is the one that proves the
              // check is looking at something.
              expect(await controls.count()).toBeGreaterThanOrEqual(4);
              await body.getByRole('button', { name: /^Open .* in Docket$/ }).click();
              await expect
                .poll(() => page.evaluate(() => window.receivedLinks))
                .toEqual(['/orgs/org_1/tasks/t_1']);
            }
            if (testCase.name.endsWith('projects-batch')) {
              await expectEveryRowOpens(page, view.contentFrame(), [
                '/orgs/org_1/projects/p_1',
                '/orgs/org_1/projects/p_2',
                '/orgs/org_1/projects/p_3',
              ]);
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

            if ((await body.getAttribute('data-display-mode')) === 'fullscreen') {
              const full = await body.evaluate(
                () => document.querySelector('.card')?.scrollHeight ?? 0,
              );
              await page.evaluate((height) => {
                window.growFrame(height);
              }, full);
            }
            // Off the card, so a hover hint left by a click above is not photographed as layout.
            await page.mouse.move(0, 0);
            await page.screenshot({
              fullPage: true,
              path: join(SHOT_DIR, `${testCase.name}-${palette}-${theme}-${width.name}.png`),
            });
          });
        }
      });
    }
  }
}
