/** Render the production MCP resource and project real synthetic graph data through a sandbox host. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import axe from 'axe-core';
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
window.calls=[];window.contexts=[];window.messages=[];window.pending=[];window.hold=false;window.fail=false;
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow)return;const m=event.data;if(!m||m.jsonrpc!=='2.0')return;
 const send=result=>frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
 if(m.method==='ui/initialize')send({protocolVersion:'2026-01-26',hostInfo:{name:'Acceptance host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{theme,locale:'en-US',availableDisplayModes:query.get('deny')?['inline']:['inline','fullscreen']}});
 if(m.method==='ui/notifications/initialized'){
  frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:kind==='list'?{orgId:'demo',entity:'task',project:'identity',state:['doing']}:kind==='entity'?{orgId:'demo',refs:['portal']}:{orgId:'demo',scope:{kind:'program',id:'portal'}}}},'*');
  frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:kind==='entity'?entity:kind==='list'?list:initial,content:[]}},'*');
 }
 if(m.method==='ui/notifications/size-changed')frame.style.height=m.params.height+'px';
 if(m.method==='ui/request-display-mode')send({mode:query.get('deny')?'inline':m.params.mode});
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
try {
  for (const width of [390, 1200])
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base + '/?theme=' + theme);
      const app = page.frameLocator('iframe');
      await app.getByRole('button', { name: 'Explore graph', exact: true }).waitFor();
      await app.locator('.graph-node').first().waitFor();
      await page.screenshot({
        path: resolve(output, `inline-${width}-${theme}.png`),
        fullPage: true,
      });
      await app.getByRole('button', { name: 'Explore graph', exact: true }).click();
      await page.waitForFunction(() =>
        window.calls.some((c) => c.arguments.display === 'fullscreen'),
      );
      await app.locator('.graph-node').filter({ hasText: 'Identity and access' }).click();
      await app.getByRole('button', { name: 'Expand group', exact: true }).click();
      await app.locator('.graph-node').filter({ hasText: 'Review team permissions' }).waitFor();
      await app.locator('.graph-node').filter({ hasText: 'Review team permissions' }).click();
      await app.getByRole('button', { name: 'Trace prerequisites', exact: true }).click();
      await app.getByRole('button', { name: 'Ask about this', exact: true }).click();
      await page.waitForFunction(() => window.contexts.length > 0 && window.messages.length === 1);
      await app.locator('body').evaluate(() => {
        for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0;
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: resolve(output, `expanded-${width}-${theme}.png`),
        fullPage: true,
      });
      await app.getByRole('button', { name: 'Relationship list', exact: true }).click();
      await app.locator('.graph-relations').waitFor();
      await app.getByText('Member portal contains Identity and access', { exact: true }).waitFor();
      const listSelection = app
        .locator('[data-graph-select]')
        .filter({ hasText: 'Review team permissions' });
      await listSelection.focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await app
          .locator('body')
          .evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() =>
                  resolve(document.activeElement?.getAttribute('data-graph-select')),
                ),
              ),
          ),
        'task:t03',
      );
      const overflow = await app
        .locator('body')
        .evaluate((body) => body.scrollWidth > body.clientWidth + 1);
      assert.equal(overflow, false);
      await app.locator('body').evaluate((_, source) => {
        const script = document.createElement('script');
        script.textContent = source;
        document.head.appendChild(script);
      }, axe.source);
      const audit = await app
        .locator('body')
        .evaluate(async () =>
          window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }),
        );
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
  for (const scenario of ['empty', 'completed', 'disconnected', 'oversized'])
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 900 },
        colorScheme: theme,
      });
      await page.goto(base + '/?scenario=' + scenario + '&theme=' + theme);
      const app = page.frameLocator('iframe');
      await app.getByRole('button', { name: 'Explore graph', exact: true }).waitFor();
      if (scenario === 'empty')
        await app.getByText('No work recorded here yet', { exact: true }).waitFor();
      if (scenario === 'completed') {
        await app.getByRole('button', { name: 'Explore graph', exact: true }).click();
        await app
          .getByRole('button', { name: 'Expand completed work in Identity and access' })
          .click();
        await app.locator('.graph-node').filter({ hasText: 'Create an account' }).waitFor();
      }
      if (scenario === 'disconnected')
        assert.equal(await app.locator('.graph-edges > path').count(), 0);
      if (scenario === 'oversized') {
        await app.getByRole('button', { name: 'Explore graph', exact: true }).click();
        await app.getByRole('button', { name: 'Next page', exact: true }).waitFor();
        assert.equal(await app.locator('.graph-node').count(), 100);
        await app.getByRole('button', { name: 'Next page', exact: true }).click();
        await page.waitForFunction(() => window.calls.some((c) => c.arguments.page === 1));
        await app.getByRole('button', { name: 'Previous page', exact: true }).waitFor();
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
  for (const kind of ['entity', 'list']) {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    await page.goto(base + '/?kind=' + kind + '&deny=1');
    const app = page.frameLocator('iframe');
    await app.getByRole('button', { name: 'View work graph', exact: true }).click();
    await app.getByRole('button', { name: 'Back', exact: true }).waitFor();
    if (kind === 'list')
      assert(await page.evaluate(() => window.calls[0].arguments.focusFilter.state[0] === 'doing'));
    await app.getByRole('button', { name: 'Explore graph', exact: true }).click();
    assert.equal(await app.locator('body').getAttribute('data-display-mode'), 'inline');
    await app.getByRole('button', { name: 'Back', exact: true }).click();
    await app.getByRole('button', { name: 'View work graph', exact: true }).waitFor();
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(base);
  const app = page.frameLocator('iframe');
  await app.locator('.graph-node').first().waitFor();
  await page.evaluate(() => {
    window.fail = true;
  });
  await app.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await app.getByRole('status').filter({ hasText: 'could not be loaded' }).waitFor();
  assert((await app.locator('.graph-node').count()) > 0);
  await page.close();
  writeFileSync(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  process.stdout.write(
    JSON.stringify({ passed: true, captures: results.length * 2 + 8, results }) + '\n',
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
