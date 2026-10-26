/** Standard MCP host sizing exercised by the graph acceptance sandbox. */
export const HOST_LAYOUT = String.raw`
const maxWidth=Number(query.get('maxWidth'))||null;
const maxHeight=Number(query.get('maxHeight'))||window.innerHeight;
const safe=query.has('safe')?{top:24,right:12,bottom:34,left:12}:{top:0,right:0,bottom:0,left:0};
window.hostDimensions=()=>window.expanded?{width:window.innerWidth,height:window.innerHeight}:maxWidth?{maxWidth,maxHeight}:{width:window.innerWidth,maxHeight};
window.currentDimensions=window.hostDimensions();
window.updateHost=(update)=>{
 if(update.containerDimensions){const dims=update.containerDimensions;window.currentDimensions=dims;frame.style.width=typeof dims.width==='number'?dims.width+'px':maxWidth?Math.min(maxWidth,window.innerWidth)+'px':'100%';if(typeof dims.height==='number')frame.style.height=dims.height+'px';}
 frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:update},'*');
};
window.addEventListener('resize',()=>window.updateHost({containerDimensions:window.hostDimensions()}));
`;

/** Verify real container bounds, context-only resizing, safe areas and rejected expansion. */
export async function verifyHostLayout(browser, base, output, settleLayout) {
  const { default: assert } = await import('node:assert/strict');
  const { resolve } = await import('node:path');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '/?maxWidth=390&maxHeight=460');
  const app = page.frameLocator('iframe');
  await app.getByRole('button', { name: 'Open graph', exact: true }).waitFor();
  await page.waitForTimeout(150);
  assert((await app.locator('body').boundingBox()).width <= 390, 'Flexible inline width cap');
  assert.equal(await app.locator('body').evaluate((b) => b.scrollWidth > b.clientWidth + 1), false);
  await app.getByRole('button', { name: 'Open graph', exact: true }).click();
  await app.locator('.graph-stage').waitFor();
  await page.waitForTimeout(180);
  await settleLayout(app);
  let bounds = await app.locator('.graph-stage').boundingBox();
  assert.equal(Math.round(bounds.width), 1440, 'Fullscreen clears the prior width cap');
  assert(bounds.height > 800, 'Fullscreen uses the fixed host height');
  const calls = await page.evaluate(() => window.calls.length);
  await page.evaluate(() =>
    window.updateHost({ containerDimensions: { width: 1200, height: 700 } }),
  );
  await page.waitForTimeout(200);
  bounds = await app.locator('.graph-stage').boundingBox();
  assert.equal(Math.round(bounds.width), 1200, 'Same-mode context updates width');
  assert(bounds.height > 600 && bounds.height < 650, 'Same-mode context updates height');
  assert.equal(
    await page.evaluate(() => window.calls.length),
    calls,
    'Same geometry shape resizes locally',
  );
  await page.screenshot({ path: resolve(output, 'host-fixed-resize.png') });
  // A geometry update must not replace an in-flight completion choice with old arguments.
  await page.evaluate(() => {
    window.hold = true;
    window.pending = [];
  });
  await app.locator('summary[aria-label="Graph options"]').click();
  await app.getByLabel('Work to show').selectOption('all');
  await page.waitForFunction(() => window.pending.length === 1);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => window.pending.length),
    1,
    'Resize waits for pending user read',
  );
  await page.evaluate(() => {
    window.hold = false;
    const p = window.pending[0];
    document
      .querySelector('iframe')
      .contentWindow.postMessage(
        { jsonrpc: '2.0', id: p.id, result: { structuredContent: p.response, content: [] } },
        '*',
      );
  });
  await page.waitForFunction(() => window.calls.at(-1).arguments.viewport === 'portrait');
  assert.equal(
    await page.evaluate(() => window.calls.at(-1).arguments.completion),
    'all',
    'Deferred layout retains the chosen filter',
  );
  await app.getByLabel('Work to show').waitFor({ state: 'attached' });
  assert.equal(await app.getByLabel('Work to show').inputValue(), 'all');
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(base + '/?safe=1');
  const mobile = phone.frameLocator('iframe');
  await mobile.getByRole('button', { name: 'Open graph', exact: true }).click();
  await mobile.locator('.graph-stage').waitFor();
  await phone.waitForTimeout(180);
  const header = await mobile.locator('.graph-workspace-header').boundingBox();
  assert(header.height <= 150, 'Mobile header retains canvas space including safe area');
  assert.equal(Math.round((await mobile.locator('.graph-stage').boundingBox()).width), 390);
  const search = await mobile.getByRole('combobox', { name: 'Search work' }).boundingBox();
  assert(search.x >= 24 && search.x + search.width <= 366, 'Search respects horizontal safe areas');
  const panel = await mobile.locator('.graph-inspector').boundingBox();
  assert(panel.y + panel.height <= 844 - 34, 'Selection respects bottom safe area');
  assert.equal(
    await mobile.locator('.graph-footer,.graph-portals').count(),
    0,
    'No permanent footer clutter',
  );
  await phone.screenshot({ path: resolve(output, 'host-mobile-safe-areas.png') });
  await phone.close();

  const denied = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await denied.goto(base + '/?refuse=1&maxHeight=420');
  const inline = denied.frameLocator('iframe');
  await inline.getByRole('button', { name: 'Open graph', exact: true }).click();
  await inline.locator('.graph-stage').waitFor();
  await denied.waitForTimeout(180);
  assert.equal(await inline.locator('body').getAttribute('data-display-mode'), 'inline');
  assert(
    (await denied.locator('iframe').boundingBox()).height <= 420,
    'Rejected fullscreen respects inline cap',
  );
  assert(
    (await inline.locator('.graph-stage').boundingBox()).height > 200,
    'Inline-only explorer remains usable',
  );
  await denied.evaluate(() =>
    window.updateHost({ containerDimensions: { width: 390, maxHeight: 600 } }),
  );
  await denied.waitForTimeout(200);
  assert(
    (await inline.locator('.graph-shell').boundingBox()).height > 550,
    'Fallback grows on context-only resize',
  );
  await denied.evaluate(() =>
    window.updateHost({ containerDimensions: { width: 390, maxHeight: 380 } }),
  );
  await denied.waitForTimeout(200);
  assert(
    (await denied.locator('iframe').boundingBox()).height <= 380,
    'Fallback shrinks on context-only resize',
  );
  await denied.screenshot({ path: resolve(output, 'host-rejected-fullscreen.png') });
  await denied.evaluate(() =>
    window.updateHost({ containerDimensions: { width: 390, height: 900 } }),
  );
  await denied.waitForTimeout(200);
  assert.equal(
    Math.round((await inline.locator('.card').boundingBox()).height),
    900,
    'Inline explorer fills an explicitly fixed host height',
  );
  await denied.close();
}
