/** Render the actual MCP resource with persisted test-account results through a local MCP host. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireWeb = createRequire(resolve(root, 'apps/web/package.json'));
const { chromium } = requireWeb('@playwright/test');
const axeSource = readFileSync(requireWeb.resolve('axe-core/axe.min.js'), 'utf8');
const evidenceDir = process.env.WORKLOAD_EVIDENCE_DIR || '/tmp/docket-workload-evidence';
const outputDir = resolve(process.env.WORKLOAD_CAPTURE_DIR || resolve(root, 'apps/api/.data/workload-captures'));
mkdirSync(outputDir, { recursive: true });
const read = (name) => JSON.parse(readFileSync(resolve(evidenceDir, name + '.json'), 'utf8'));
const resource = read('resource').contents[0].text;
const populated = read('populated');
const empty = read('empty');
const overloaded = read('overloaded');
const zero = read('zero-capacity');
const previous = read('previous');
const next = read('next');
const pacific = read('pacific');
const timeboxed = read('timeboxed-no-estimate');
const fontPath = resolve(
  root,
  'apps/api/node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-standard-normal.woff2',
);
const font = readFileSync(fontPath).toString('base64');
const host = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local workload acceptance host</title><style>html,body{margin:0;min-height:100%;background:var(--bg,#fff)}iframe{border:0;width:100%;display:block}</style></head><body><iframe title="Docket daily workload" sandbox="allow-scripts"></iframe><script>
const resource=${JSON.stringify(resource).replaceAll('<', '\\u003c')};
const fixtures=${JSON.stringify({ populated, empty, overloaded, zero, previous, next, pacific, timeboxed }).replaceAll('<', '\\u003c')};
const font=${JSON.stringify(font)};
const scenario=new URLSearchParams(location.search).get('state') || 'populated';
const theme=new URLSearchParams(location.search).get('theme') || 'light';
const frame=document.querySelector('iframe');
document.documentElement.style.colorScheme=theme;
document.body.style.setProperty('--bg',theme==='dark'?'#1c1c20':'#fff');
window.calls=[];window.failNext=false;window.pendingReads=[];window.holdReads=false;
window.addEventListener('message',event=>{
 if(event.source!==frame.contentWindow)return;
 const m=event.data;if(!m||m.jsonrpc!=='2.0')return;
 const send=(result)=>frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
 if(m.method==='ui/initialize')send({protocolVersion:'2026-01-26',hostInfo:{name:'Local acceptance host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{theme,locale:'en-US',timeZone:'UTC',styles:{variables:{'--font-sans':'"IBM Plex Sans",sans-serif'},css:{fonts:'@font-face{font-family:"IBM Plex Sans";src:url(data:font/woff2;base64,'+font+')}'}},availableDisplayModes:['inline']}});
 if(m.method==='ui/notifications/initialized'){
  const initial=fixtures[scenario]||fixtures.populated;frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:{orgId:initial.orgId,date:initial.date,timezone:initial.timezone,availableHours:initial.availableHours}}},'*');
  if(scenario!=='loading')frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:scenario==='error'?{isError:true,content:[{type:'text',text:'private backend error must never render'}]}:{structuredContent:fixtures[scenario]||fixtures.populated,content:[]}},'*');
 }
 if(m.method==='ui/notifications/size-changed')frame.style.height=m.params.height+'px';
 if(m.method==='tools/call'){
  window.calls.push(m.params);
  if(window.holdReads){window.pendingReads.push({id:m.id,params:m.params});return;}
  if(window.failNext){window.failNext=false;send({isError:true,content:[]});return;}
  const a=m.params.arguments;const data=a.timezone==='America/Los_Angeles'?fixtures.pacific:a.date==='2026-10-13'?fixtures.previous:a.date==='2026-10-15'?fixtures.next:a.availableHours===0?fixtures.zero:a.availableHours===1?fixtures.overloaded:fixtures.populated;
  send({structuredContent:data,content:[]});
 }
});
frame.srcdoc=resource;
</script></body></html>`;
const server = createServer((_, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(host);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert(address && typeof address === 'object');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [390, 600],
    [320, 844],
    [1920, 1080],
  ]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width, height },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + address.port + '/?theme=' + theme);
      const frame = page.frameLocator('iframe');
      await frame.locator('body[data-state="ready"]').waitFor();
      await frame
        .locator('#scope')
        .getByText('Workload test workspace', { exact: false })
        .waitFor();
      await frame.locator('#group').selectOption('task');
      await frame.locator('h1').evaluate(() => document.fonts.ready);
      await frame.locator('body').evaluate((_, source) => {
        const script = document.createElement('script');
        script.textContent = source;
        document.head.append(script);
      }, axeSource);
      await frame.locator('details').evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
      const axe = await frame.locator('body').evaluate(
        async () =>
          await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          }),
      );
      if (axe.violations.length) {
        await page.screenshot({ path: resolve(outputDir, `a11y-failure-${width}-${theme}.png`), fullPage: true });
        console.log('Accessibility diagnostic', { width, height, theme }, await frame.locator('body').evaluate((body) => ({ color: getComputedStyle(body).color, background: getComputedStyle(body).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme })));
      }
      assert.deepEqual(
        axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.html),
        })),
        [],
        'WCAG accessibility violations',
      );
      assert.equal(
        await frame.locator('html').evaluate((html) => html.scrollWidth > innerWidth),
        false,
        'expanded controls/table overflow',
      );
      await frame.locator('details').evaluateAll((nodes) => nodes.forEach((n) => (n.open = false)));
      const closedHeight = await frame.locator('body').evaluate((body) => Math.ceil(body.getBoundingClientRect().height));
      await page.waitForFunction((expected) => document.querySelector('iframe').getBoundingClientRect().height <= expected + 2, closedHeight, { timeout: 5000 });


      const overflow = await frame
        .locator('html')
        .evaluate((html) => html.scrollWidth > innerWidth);
      if (overflow) {
        await page.screenshot({
          path: resolve(outputDir, `overflow-${width}x${height}-${theme}.png`),
          fullPage: true,
        });
        console.log(
          JSON.stringify(
            await frame.locator('body').evaluate(() =>
              [...document.querySelectorAll('*')]
                .filter((n) => n.getBoundingClientRect().right > innerWidth + 1)
                .map((n) => ({
                  tag: n.tagName,
                  className: n.className,
                  id: n.id,
                  width: n.getBoundingClientRect().width,
                  right: n.getBoundingClientRect().right,
                })),
            ),
            null,
            2,
          ),
        );
      }
      assert.equal(overflow, false, 'horizontal overflow');
      assert.equal(
        await frame
          .locator('.workload-toolbar button')
          .evaluateAll((buttons) => buttons.some((b) => b.scrollHeight > b.clientHeight + 2)),
        false,
        'wrapped/clipped toolbar labels',
      );
      await page.screenshot({
        path: resolve(outputDir, `workload-${width}x${height}-${theme}.png`),
        fullPage: true,
      });
      if (width === 390 && theme === 'light') {
        await frame.locator('#settings').evaluate((n) => {
          n.open = true;
        });
        await frame.locator('#hours').fill('1');
        await frame.locator('#apply').click();
        await frame.locator('#metrics').getByText('Over capacity', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.calls.at(-1).name), 'view_workload');
        await page.screenshot({
          path: resolve(outputDir, 'overloaded-390-light.png'),
          fullPage: true,
        });
        await frame.locator('#hours').fill('0');
        await frame.locator('#apply').click();
        await frame
          .locator('#metrics')
          .getByText('No hours budget', { exact: false })
          .first()
          .waitFor();
        await page.screenshot({
          path: resolve(outputDir, 'zero-capacity-390-light.png'),
          fullPage: true,
        });
      }
      if (width === 390 && theme === 'dark') {
        await frame.locator('#settings').evaluate((n) => (n.open = true));
        await frame.locator('#day').fill('2026-10-13');
        await frame.locator('#timezone').fill('America/Los_Angeles');
        await frame.locator('#hours').focus();
        await page.keyboard.press('Enter');
        await frame
          .locator('#settings-label')
          .getByText('America/Los_Angeles', { exact: false })
          .waitFor();
        assert.equal(
          await page.evaluate(() => window.calls.at(-1).arguments.timezone),
          'America/Los_Angeles',
        );
        await page.screenshot({
          path: resolve(outputDir, 'timezone-390-dark.png'),
          fullPage: true,
        });
      }
      if (width === 1440 && theme === 'light') {
        await frame.locator('#filter').selectOption(populated.tasks[0].id);
        assert.equal(await frame.locator('#chart .workload-chart-row').count(), 1);
        const metrics = await frame.locator('#metrics').innerText();
        await frame.locator('#filter').selectOption('');
        assert.equal(
          await frame.locator('#metrics').innerText(),
          metrics,
          'filters changed headline totals',
        );
        await frame.locator('#search').fill('impossible search');
        await frame.getByText('No work matches these filters', { exact: true }).waitFor();
        await frame.locator('#search').fill('');
        await frame.locator('#group').selectOption('priority');
        assert((await frame.locator('#chart .workload-chart-row').count()) > 0);
        await page.evaluate(() => {
          window.failNext = true;
        });
        await frame.locator('#refresh').click();
        await frame.locator('#retry').waitFor({ state: 'visible' });
        assert.equal(
          await frame.locator('#metrics').innerText(),
          metrics,
          'refresh failure lost data',
        );
        await page.screenshot({
          path: resolve(outputDir, 'refresh-error-1440-light.png'),
          fullPage: true,
        });
        await frame.locator('#retry').click();
        await frame.getByText('Workload updated.', { exact: true }).waitFor();
        await page.keyboard.press('Tab');
        const focus = await frame
          .locator(':focus')
          .evaluate((n) => ({ tag: n.tagName, outline: getComputedStyle(n).outlineStyle }));
        assert.notEqual(focus.outline, 'none', 'keyboard focus invisible');
        await frame.locator('#previous').focus();
        await page.keyboard.press('Enter');
        await frame.getByText('Workload updated.', { exact: true }).waitFor();
        const previous = await page.evaluate(() => window.calls.at(-1));
        assert.equal(previous.arguments.date, '2026-10-13');
        await frame.locator('#scope').getByText('Oct 13, 2026', { exact: false }).waitFor();
        await frame.locator('#next-day').click();
        await frame.locator('#scope').getByText('Oct 14, 2026', { exact: false }).waitFor();
        await page.evaluate(() => {
          window.holdReads = true;
        });
        await frame.locator('#next-day').click();
        await frame.locator('#previous').click();
        await page.waitForFunction(() => window.pendingReads.length === 2);
        assert.deepEqual(await page.evaluate(() => window.pendingReads.map((read) => read.params.arguments.date)), ['2026-10-15', '2026-10-14'], 'relative navigation did not follow the requested day');
        await page.evaluate(() => {
          const a = window.pendingReads;
          const f = document.querySelector('iframe');
          const data = fixtures.populated;
          f.contentWindow.postMessage(
            { jsonrpc: '2.0', id: a[1].id, result: { structuredContent: fixtures.overloaded } },
            '*',
          );
          f.contentWindow.postMessage(
            { jsonrpc: '2.0', id: a[0].id, result: { structuredContent: data } },
            '*',
          );
          window.holdReads = false;
        });
        await frame.locator('#metrics').getByText('Over capacity', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, [], 'browser exceptions');
      results.push({ width, height, theme, overflow: false, wcagViolations: 0, consoleErrors: errors });
      await page.close();
    }
  }
  const touch = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  await touch.goto('http://127.0.0.1:' + address.port);
  const touchFrame = touch.frameLocator('iframe');
  await touchFrame.locator('body[data-state="ready"]').waitFor();
  await touchFrame.locator('details').evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
  const smallTargets = await touchFrame
    .locator('button,input,select,summary')
    .evaluateAll((nodes) =>
      nodes
        .filter(
          (n) => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().height < 40,
        )
        .map((n) => ({ id: n.id, tag: n.tagName, height: n.getBoundingClientRect().height })),
    );
  assert.deepEqual(smallTargets, [], 'coarse-pointer target size');
  await touchFrame.locator('html').evaluate((html) => (html.style.fontSize = '200%'));
  assert.equal(
    await touchFrame.locator('html').evaluate((html) => html.scrollWidth > innerWidth),
    false,
    '200% text overflow',
  );
  await touch.screenshot({
    path: resolve(outputDir, 'touch-text-200-390-light.png'),
    fullPage: true,
  });
  await touch.close();
  for (const theme of ['light', 'dark']) {
    for (const state of ['empty', 'timeboxed', 'loading', 'error']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto('http://127.0.0.1:' + address.port + '/?state=' + state + '&theme=' + theme);
      const frame = page.frameLocator('iframe');
      await frame
        .locator(
          'body[data-state="' +
            (state === 'empty' || state === 'timeboxed'
              ? 'ready'
              : state === 'loading'
                ? 'loading'
                : 'error') +
            '"]',
        )
        .waitFor();
      if (state === 'timeboxed')
        await frame
          .getByText(
            '1 task estimate missing; the day plan uses timeboxed hours. Headroom is provisional.',
            { exact: true },
          )
          .waitFor();
      if (state === 'empty')
        await frame.getByText('No work recorded for this day', { exact: true }).waitFor();
      if (state === 'error') {
        assert(!(await frame.locator('body').innerText()).includes('private backend'));
        await frame.locator('#retry-initial').waitFor({ state: 'visible' });
      }
      await page.screenshot({
        path: resolve(outputDir, state + '-390-' + theme + '.png'),
        fullPage: true,
      });
      if (state === 'error') {
        await frame.locator('#retry-initial').click();
        await frame.locator('body[data-state="ready"]').waitFor();
      }
      await page.close();
    }
  }
  writeFileSync(
    resolve(outputDir, 'verification.json'),
    JSON.stringify(
      {
        source:
          'MCP resource and persisted PGlite test-account output; local host bridge; no production session',
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `Verified ${results.length} width/theme combinations, empty/loading/error, filters, capacity, read-only navigation, keyboard focus, WCAG scans, coarse targets, 200% text, retry and stale-response handling.`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
