/** Render the production MCP resource and project real synthetic graph data through a sandbox host. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import axe from 'axe-core';
import { openWorkDetails, graphAction } from './verify-work-graph-actions.mjs';
import { HOST_LAYOUT, verifyHostLayout } from './verify-work-graph-host.mjs';
import {
  verifySearchReturn,
  verifyMatchPages,
  verifySelectionRace,
  verifyReturnAcrossModes,
  verifyRefreshAndBack,
  verifyNarrowGraphActions,
} from './verify-work-graph-search.mjs';
import { API_TEST_ENV } from '../apps/api/tests/support/env.ts';
Object.assign(process.env, API_TEST_ENV);
const { WORK_GRAPH_HTML } = await import('../apps/api/src/mcp/apps/work-graph.ts');
const { entityDocument } = await import('../apps/api/src/mcp/apps/entity.ts');
const { WORK_LIST_HTML } = await import('../apps/api/src/mcp/apps/work-list.ts');
const { projectWorkGraph } = await import('../apps/api/src/work-graph/projection.ts');
const { graphFixture } = await import('../apps/api/tests/work-graph/fixtures.ts');
const output = process.env.GRAPH_CAPTURE_DIR;
assert(output, 'Set GRAPH_CAPTURE_DIR to the guarded artifact root.');
mkdirSync(output, { recursive: true });
const data = graphFixture();
const args = { orgId: 'demo', scope: { kind: 'program', id: 'portal' } };
const denseNodes = Array.from({ length: 250 }, (_, i) => ({
  key: 'task:d' + i,
  id: 'd' + i,
  kind: 'task',
  title: 'Work item ' + String(i).padStart(3, '0'),
  status: 'To do',
  category: 'unstarted',
  priority: 'none',
  href: '/tasks/d' + i,
}));
const variants = {
  populated: data,
  longtitles: {
    nodes: data.nodes.map((n) =>
      n.key === 'task:t03' || n.key === 'program:portal'
        ? {
            ...n,
            title:
              n.title + ' — ' + 'Accessible membership administration and permissions '.repeat(8),
          }
        : n,
    ),
    relations: data.relations,
  },
  subtasks: {
    nodes: [
      ...data.nodes,
      { ...denseNodes[0], key: 'task:child', id: 'child', title: 'Check role permissions' },
    ],
    relations: [...data.relations, { source: 'task:t03', target: 'task:child', kind: 'contains' }],
  },
  empty: { nodes: data.nodes.filter((n) => n.key === 'program:portal'), relations: [] },
  completed: {
    nodes: data.nodes.map((n) => ({ ...n, category: 'completed', status: 'Done' })),
    relations: data.relations,
  },
  disconnected: {
    nodes: data.nodes,
    relations: data.relations.filter((r) => !r.kind.endsWith('_dependency')),
  },
  oversized: {
    nodes: [data.nodes.find((n) => n.key === 'program:portal'), ...denseNodes],
    relations: denseNodes.map((n) => ({
      source: 'program:portal',
      target: n.key,
      kind: 'contains',
    })),
  },
};
const initialScenes = Object.fromEntries(
  Object.entries(variants).map(([name, source]) => [name, projectWorkGraph(source, args)]),
);
const resources = {
  graph: WORK_GRAPH_HTML,
  entity: entityDocument('program'),
  list: WORK_LIST_HTML,
};
const entity = {
  items: [
    {
      id: 'portal',
      name: 'Member portal',
      status: 'active',
      href: '/orgs/demo/programs/portal',
      projects: [],
    },
  ],
  missing: [],
};
const list = {
  entity: 'task',
  items: [
    { id: 't03', title: 'Review team permissions', stateType: 'started', href: '/tasks/t03' },
  ],
  graphScope: { kind: 'project', id: 'identity' },
};
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local graph acceptance host</title><style>body{margin:0;background:var(--bg)}iframe{border:0;width:100%;display:block}</style></head><body><iframe title="Docket work graph" sandbox="allow-scripts"></iframe><script>
const query=new URLSearchParams(location.search),theme=query.get('theme')||'light',kind=query.get('kind')||'graph',scenario=query.get('scenario')||'populated';
const resources=${JSON.stringify(resources).replaceAll('<', '\\u003c')};
const scenes=${JSON.stringify(initialScenes).replaceAll('<', '\\u003c')};const initial=scenes[scenario]||scenes.populated;
const entity=${JSON.stringify(entity)};const list=${JSON.stringify(list)};
const frame=document.querySelector('iframe');document.body.style.setProperty('--bg',theme==='dark'?'#1c1c20':'#fff');
${HOST_LAYOUT}
window.expanded=false;window.calls=[];window.contexts=[];window.messages=[];window.pending=[];window.hold=false;window.fail=false;
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow)return;const m=event.data;if(!m||m.jsonrpc!=='2.0')return;
 const send=result=>frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
 if(m.method==='ui/initialize')send({protocolVersion:'2026-01-26',hostInfo:{name:'Acceptance host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{theme,locale:'en-US',displayMode:'inline',containerDimensions:window.hostDimensions(),safeAreaInsets:safe,availableDisplayModes:query.get('deny')?['inline']:['inline','fullscreen']}});
 if(m.method==='ui/notifications/initialized'){
  frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:kind==='list'?{orgId:'demo',entity:'task',project:'identity',state:['doing']}:kind==='entity'?{orgId:'demo',refs:['portal']}:{orgId:'demo',scope:{kind:'program',id:'portal'}}}},'*');
  frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:kind==='entity'?entity:kind==='list'?list:initial,content:[]}},'*');
 }
 if(m.method==='ui/notifications/size-changed'&&!window.expanded){frame.style.height=Math.min(window.currentDimensions.maxHeight||Infinity,m.params.height)+'px';if(maxWidth)frame.style.width=Math.min(maxWidth,m.params.width,window.innerWidth)+'px';}
 if(m.method==='ui/request-display-mode'){window.expanded=!query.get('deny')&&!query.get('refuse')&&m.params.mode==='fullscreen';window.updateHost({displayMode:window.expanded?'fullscreen':'inline',containerDimensions:window.hostDimensions()});send({mode:window.expanded?'fullscreen':'inline'});}
 if(m.method==='ui/update-model-context'){window.contexts.push(m.params);send({});}
 if(m.method==='ui/message'){window.messages.push(m.params);send({});}
 if(m.method==='tools/call'){
  window.calls.push(m.params);if(window.fail){window.fail=false;send({isError:true,content:[]});return;}
  const response=await fetch('/call?scenario='+encodeURIComponent(scenario),{method:'POST',body:JSON.stringify(m.params.arguments)}).then(r=>r.json());
  if(window.hold){window.pending.push({id:m.id,response});return;}send({structuredContent:response,content:[]});
 }
});frame.srcdoc=resources[kind]||resources.graph;
</script></body></html>`;
const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname === '/call') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    // The list fixture's custom state is a focus annotation; projection still uses the full graph.
    if (input.focusFilter) input.focusKeys = ['task:t03'];
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        projectWorkGraph(variants[requestUrl.searchParams.get('scenario')] || data, input),
      ),
    );
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
const results = [];
const settleLayout = (app) =>
  app
    .locator('body')
    .evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
const auditSurface = (app) =>
  app
    .locator('body')
    .evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }));
try {
  for (const width of [390, 1440])
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base + '/?theme=' + theme);
      const app = page.frameLocator('iframe');
      await app.getByRole('button', { name: 'Open graph', exact: true }).waitFor();
      await app.locator('[data-graph-select]').first().waitFor();
      assert(
        (await page.locator('iframe').boundingBox()).height < 480,
        'Inline dependency review should stay compact',
      );
      await app
        .locator('.graph-shell')
        .screenshot({ path: resolve(output, `inline-${width}-${theme}.png`) });
      await app.getByRole('button', { name: 'Open graph', exact: true }).click();
      await page.waitForFunction(() =>
        window.calls.some((c) => c.arguments.display === 'fullscreen'),
      );
      await page.screenshot({ path: resolve(output, `expanded-overview-${width}-${theme}.png`) });
      const groupToggle = app.locator('[data-graph-toggle="project:identity"]');
      if ((await groupToggle.getAttribute('aria-expanded')) === 'true') await groupToggle.click();
      await groupToggle.click();
      await app.locator('.graph-node').filter({ hasText: 'Review team permissions' }).waitFor();
      await app.locator('.graph-node').filter({ hasText: 'Review team permissions' }).click();
      await openWorkDetails(app);
      assert.equal(await app.getByRole('button', { name: /trace/i }).count(), 0);
      assert.equal(
        await app.getByRole('button', { name: 'Highlight work needed first', exact: true }).count(),
        0,
        'No highlight action for prerequisites outside the displayed graph',
      );
      await app
        .getByRole('button', { name: 'Highlight work that depends on this', exact: true })
        .click();
      assert(
        (await app.locator('.graph-node[data-traced=true]').count()) >= 2,
        'Highlight connects visible work',
      );
      await app.getByRole('button', { name: 'Clear highlights', exact: true }).click();
      assert.equal(await app.locator('.graph-node[data-traced=true]').count(), 0);
      await app
        .getByRole('button', { name: 'Highlight work that depends on this', exact: true })
        .click();
      await app.getByRole('button', { name: 'Ask in chat', exact: true }).click();
      await page.waitForFunction(() => window.contexts.length > 0 && window.messages.length === 1);
      await app.locator('body').evaluate(() => {
        for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0;
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path: resolve(output, `details-${width}-${theme}.png`) });
      const hide = app.getByRole('button', { name: 'Hide details', exact: true });
      if (await hide.isVisible()) await hide.click();
      await settleLayout(app);
      await page.screenshot({
        path: resolve(output, `expanded-${width}-${theme}.png`),
        fullPage: true,
      });
      assert.equal(
        await app.locator('.graph-node-kind').count(),
        0,
        'Work titles do not repeat a Task label',
      );
      assert(
        (await app.locator('.graph-stage').boundingBox()).height > 500,
        'Expanded map uses the host height',
      );
      await app.locator('body').evaluate((_, source) => {
        const script = document.createElement('script');
        script.textContent = source;
        document.head.appendChild(script);
      }, axe.source);
      const mapAudit = await auditSurface(app);
      assert.deepEqual(
        mapAudit.violations.map((v) => ({ id: v.id, count: v.nodes.length })),
        [],
        'Map accessibility',
      );
      const search = app.getByRole('combobox', { name: 'Search work' });
      if (width === 390)
        assert((await search.boundingBox()).height >= 40, 'Search supports touch input');
      const priorView = await app.locator('.graph-world').getAttribute('style');
      const priorGroups = await app
        .locator('[data-graph-toggle]')
        .evaluateAll((nodes) =>
          nodes.map((n) => [n.dataset.graphToggle, n.getAttribute('aria-expanded')]),
        );
      if (width === 390 && theme === 'light') {
        await page.evaluate(() => {
          window.hold = true;
          window.pending = [];
        });
        await search.fill('permissions');
        await page.waitForFunction(() => window.pending.length === 1);
        await page.screenshot({ path: resolve(output, 'search-loading-390-light.png') });
        await search.fill('launch guide');
        await page.waitForFunction(() => window.pending.length === 2);
        await page.evaluate(() => {
          window.hold = false;
          for (const pending of [...window.pending].reverse())
            document.querySelector('iframe').contentWindow.postMessage(
              {
                jsonrpc: '2.0',
                id: pending.id,
                result: { structuredContent: pending.response, content: [] },
              },
              '*',
            );
        });
      } else await search.fill('launch guide');
      await app.getByRole('option').filter({ hasText: 'Write the launch guide' }).waitFor();
      await page.screenshot({ path: resolve(output, `search-results-${width}-${theme}.png`) });
      const searchAudit = await auditSurface(app);
      assert.deepEqual(
        searchAudit.violations.map((v) => ({ id: v.id, count: v.nodes.length })),
        [],
        'Search accessibility',
      );
      await search.press('ArrowDown');
      await search.press('Enter');
      await app.getByRole('heading', { name: 'Write the launch guide', exact: true }).waitFor();
      await settleLayout(app);
      const revealed = await app.locator('[data-graph-select="task:t12"]').boundingBox();
      const map = await app.locator('.graph-stage').boundingBox();
      assert(
        revealed.x >= map.x && revealed.x + revealed.width <= map.x + map.width + 1,
        'Search match framed horizontally',
      );
      assert(
        revealed.y >= map.y && revealed.y + revealed.height <= map.y + map.height,
        'Search match framed vertically',
      );
      await page.screenshot({ path: resolve(output, `search-reveal-${width}-${theme}.png`) });
      await openWorkDetails(app);
      await verifySearchReturn(app, priorView, priorGroups, settleLayout);
      await page.screenshot({ path: resolve(output, `search-return-${width}-${theme}.png`) });
      await search.fill('passkey');
      await app.getByRole('option').filter({ hasText: 'Sign in with a passkey' }).click();
      await app.getByRole('heading', { name: 'Sign in with a passkey', exact: true }).waitFor();
      assert.equal(await app.getByLabel('Work to show').inputValue(), 'all');
      await app.getByRole('button', { name: 'Back to previous view', exact: true }).click();
      await settleLayout(app);
      assert.equal(
        await app.getByLabel('Work to show').inputValue(),
        'collapsed',
        'Search Back restores completion filter',
      );
      if (width === 390 && theme === 'light') await verifySelectionRace(page, app, settleLayout);
      await search.fill('Review team permissions');
      await app.getByRole('option').filter({ hasText: 'Review team permissions' }).click();
      await app.getByRole('heading', { name: 'Review team permissions', exact: true }).waitFor();
      if (width === 390) await verifyNarrowGraphActions(page, app, settleLayout);
      await graphAction(app, 'View as list');
      await app.locator('.graph-relations').waitFor();
      await app.getByText('Member portal contains Identity and access', { exact: true }).waitFor();
      const listSelection = app
        .locator('[data-graph-select]')
        .filter({ hasText: 'Review team permissions' });
      await listSelection.focus();
      await page.keyboard.press('Enter');
      await settleLayout(app);
      assert.equal(
        await app
          .locator('body')
          .evaluate(() => document.activeElement?.getAttribute('data-graph-select')),
        'task:t03',
      );
      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 844 });
        await page.waitForTimeout(350);
        assert.equal(
          await app.locator('body').evaluate((body) => body.scrollWidth > body.clientWidth + 1),
          false,
        );
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(350);
      }
      const overflow = await app
        .locator('body')
        .evaluate((body) => body.scrollWidth > body.clientWidth + 1);
      assert.equal(overflow, false);

      const audit = await auditSurface(app);
      if (audit.violations.length) {
        writeFileSync(
          resolve(output, 'accessibility-failure.json'),
          JSON.stringify(audit.violations, null, 2),
        );
        process.stdout.write(
          JSON.stringify(
            audit.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes
                .slice(0, 3)
                .map((n) => ({ target: n.target, summary: n.failureSummary })),
            })),
          ) + '\n',
        );
      }
      assert.deepEqual(
        audit.violations.map((v) => ({ id: v.id, count: v.nodes.length })),
        [],
      );
      assert.deepEqual(errors, []);
      results.push({ width, theme, overflow, accessibilityViolations: audit.violations.length });
      await page.close();
    }
  for (const scenario of ['empty', 'completed', 'disconnected', 'oversized', 'longtitles'])
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 900 },
        colorScheme: theme,
      });
      await page.goto(base + '/?scenario=' + scenario + '&theme=' + theme);
      const app = page.frameLocator('iframe');
      await app.getByRole('button', { name: 'Open graph', exact: true }).waitFor();
      if (scenario === 'empty')
        await app.getByText('No work recorded here yet', { exact: true }).waitFor();
      if (scenario === 'completed') {
        await app.getByRole('button', { name: 'Open graph', exact: true }).click();
        const search = app.getByRole('combobox', { name: 'Search work' });
        await search.fill('Create an account');
        await app.getByRole('option').filter({ hasText: 'Create an account' }).click();
        await app.getByRole('heading', { name: 'Create an account', exact: true }).waitFor();
      }
      if (scenario === 'longtitles')
        assert(
          (await page.locator('iframe').boundingBox()).height < 480,
          'Long titles retain inline density',
        );
      if (scenario === 'disconnected')
        assert.equal(await app.locator('.graph-edges > path').count(), 0);
      if (scenario === 'oversized') {
        await app.getByRole('button', { name: 'Open graph', exact: true }).click();
        await app.getByRole('button', { name: 'Next page', exact: true }).waitFor();
        assert.equal(await app.locator('.graph-node').count(), 100);
        await app.getByRole('button', { name: 'Next page', exact: true }).click();
        await page.waitForFunction(() => window.calls.some((c) => c.arguments.page === 1));
        await app.getByRole('button', { name: 'Previous page', exact: true }).waitFor();
        const search = app.getByRole('combobox', { name: 'Search work' });
        await search.fill('Work item');
        await app.getByRole('option', { name: 'More results', exact: true }).click();
        await app.getByRole('option').filter({ hasText: 'Work item 039' }).waitFor();
        await verifyMatchPages(app);
        await search.fill('Work item 249');
        await app.getByRole('option').filter({ hasText: 'Work item 249' }).click();
        await app.getByRole('heading', { name: 'Work item 249', exact: true }).waitFor();
        assert(await app.locator('[data-graph-select="task:d249"]').count());
      }
      await page.screenshot({
        path: resolve(output, scenario + '-' + theme + '.png'),
        fullPage: true,
      });
      assert.equal(
        await app.locator('body').evaluate((body) => body.scrollWidth > body.clientWidth + 1),
        false,
      );
      await page.close();
    }
  // A subtask disclosure from a conversation row must enter the explorer, including on inline-only hosts.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + '/?scenario=subtasks&deny=1');
    const app = page.frameLocator('iframe');
    await app.locator('[data-graph-select="task:t03"]').click();
    await app.getByRole('button', { name: 'Show subtasks', exact: true }).click();
    await app.locator('[data-graph-toggle="task:t03"][aria-expanded=true]').waitFor();
    assert.equal(await app.locator('.graph-inline').count(), 0);
    assert.equal(await app.locator('body').getAttribute('data-display-mode'), 'inline');
    const toggle = app.locator('[data-graph-toggle="task:t03"]');
    await toggle.focus();
    await toggle.press('Enter');
    await app.locator('[data-graph-toggle="task:t03"][aria-expanded=false]').waitFor();
    await settleLayout(app);
    assert.equal(
      await app
        .locator('body')
        .evaluate(() => document.activeElement?.getAttribute('data-graph-toggle')),
      'task:t03',
    );
    await page.close();
  }
  await verifyHostLayout(browser, base, output, settleLayout);
  await verifyRefreshAndBack(browser, base, settleLayout);
  await verifyReturnAcrossModes(browser, base);
  for (const kind of ['entity', 'list']) {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    await page.goto(base + '/?kind=' + kind + '&deny=1');
    const app = page.frameLocator('iframe');
    await app.getByRole('button', { name: 'View work graph', exact: true }).click();
    await app.getByRole('button', { name: 'Back', exact: true }).waitFor();
    if (kind === 'list')
      assert(await page.evaluate(() => window.calls[0].arguments.focusFilter.state[0] === 'doing'));
    await app.getByRole('button', { name: 'Open graph', exact: true }).click();
    assert.equal(await app.locator('body').getAttribute('data-display-mode'), 'inline');
    await app.getByRole('button', { name: 'Back', exact: true }).click();
    await app.getByRole('button', { name: 'View work graph', exact: true }).waitFor();
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(base);
  const app = page.frameLocator('iframe');
  await app.locator('[data-graph-select]').first().waitFor();
  await page.evaluate(() => {
    window.fail = true;
  });
  await graphAction(app, 'Refresh graph');
  await app.getByRole('status').filter({ hasText: 'Couldn’t load the graph' }).waitFor();
  assert((await app.locator('[data-graph-select]').count()) > 0);
  await page.screenshot({ path: resolve(output, 'refresh-error-inline.png') });
  await app.getByRole('button', { name: 'Retry', exact: true }).click();
  await app.getByRole('status').waitFor({ state: 'hidden' });
  assert((await app.locator('[data-graph-select]').count()) > 0, 'Retry retains work');
  await page.close();
  writeFileSync(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  process.stdout.write(
    JSON.stringify({ passed: true, captures: results.length * 7 + 15, results }) + '\n',
  );
} catch (error) {
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    const details = await page.evaluate(() => ({
      calls: window.calls,
      context: window.contexts,
      pending: window.pending,
    }));
    const frame = page.frames().find((frame) => frame.parentFrame());
    if (frame)
      details.ui = await frame.evaluate(() => ({
        active: document.activeElement?.outerHTML,
        search: document.querySelector('.graph-search-wrap')?.outerHTML,
      }));
    writeFileSync(resolve(output, 'failure.json'), JSON.stringify(details, null, 2));
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
