/** Verify restoration of the graph view that preceded an explicit search jump. */
export async function verifySearchReturn(app, priorView, priorGroups, settleLayout) {
  const { default: assert } = await import('node:assert/strict');
  assert.equal(
    await app.locator('[data-relationship-key="task_dependency:task:t11"]').count(),
    1,
    'One canonical prerequisite',
  );
  assert.equal(
    await app
      .locator('.graph-inspector')
      .getByRole('button', { name: 'Membership', exact: true })
      .count(),
    0,
    'No duplicate collapsed-group prerequisite',
  );
  await app.getByRole('button', { name: 'Back to previous view', exact: true }).click();
  await settleLayout(app);
  assert.equal(
    await app.locator('.graph-world').getAttribute('style'),
    priorView,
    'Search Back restores the viewport',
  );
  assert.deepEqual(
    await app
      .locator('[data-graph-toggle]')
      .evaluateAll((nodes) =>
        nodes.map((n) => [n.dataset.graphToggle, n.getAttribute('aria-expanded')]),
      ),
    priorGroups,
    'Search Back restores groups',
  );
  assert.equal(
    await app.getByRole('combobox', { name: 'Find work in this scope' }).inputValue(),
    '',
  );
  assert.equal(
    await app.locator('[data-graph-select="task:t03"]').getAttribute('aria-pressed'),
    'true',
  );
}

/** Verify match navigation loads adjacent result pages and preserves the return destination. */
export async function verifyMatchPages(app) {
  const { default: assert } = await import('node:assert/strict');
  await app.getByRole('option').filter({ hasText: 'Work item 039' }).click();
  await app.getByRole('heading', { name: 'Work item 039', exact: true }).waitFor();
  await app.getByRole('button', { name: 'Next match', exact: true }).click();
  await app.getByRole('heading', { name: 'Work item 040', exact: true }).waitFor();
  await app.getByRole('button', { name: 'Previous match', exact: true }).click();
  await app.getByRole('heading', { name: 'Work item 039', exact: true }).waitFor();
  await app.getByRole('button', { name: 'Back to previous view', exact: true }).click();
  assert.equal(await app.getByLabel('Completed work display').inputValue(), 'collapsed');
  await app.getByRole('button', { name: 'Previous page', exact: true }).waitFor();
}

/** A late search navigation cannot replace a selection or close action made while it was loading. */
export async function verifySelectionRace(page, app, settleLayout) {
  const { default: assert } = await import('node:assert/strict');
  for (const close of [false, true]) {
    const search = app.getByRole('combobox', { name: 'Find work in this scope' });
    await search.fill('');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.hold = true;
      window.pending = [];
    });
    await search.fill('launch guide');
    await page.waitForFunction(() => window.pending.length === 1);
    await page.evaluate(() => {
      const p = window.pending[0];
      document
        .querySelector('iframe')
        .contentWindow.postMessage(
          { jsonrpc: '2.0', id: p.id, result: { structuredContent: p.response, content: [] } },
          '*',
        );
    });
    await app.getByRole('option').filter({ hasText: 'Write the launch guide' }).click();
    await page.waitForFunction(() => window.pending.length === 2);
    if (close) await page.keyboard.press('Escape');
    else {
      const work = app.locator('[data-graph-select="task:t04"]');
      await work.focus();
      await work.press('Enter');
    }
    await page.evaluate(() => {
      window.hold = false;
      const p = window.pending[1];
      document
        .querySelector('iframe')
        .contentWindow.postMessage(
          { jsonrpc: '2.0', id: p.id, result: { structuredContent: p.response, content: [] } },
          '*',
        );
    });
    await page.waitForTimeout(50);
    await settleLayout(app);
    assert.equal(
      await app.getByRole('heading', { name: 'Write the launch guide', exact: true }).count(),
      0,
      'Late search must not replace newer intent',
    );
    if (close) assert.equal(await app.locator('.graph-inspector').count(), 0);
    else
      assert.equal(
        await app.locator('[data-graph-select="task:t04"]').getAttribute('aria-pressed'),
        'true',
      );
  }
}

/** Restoring a search visit respects the host's current display mode instead of replaying a full scene inline. */
export async function verifyReturnAcrossModes(browser, base) {
  const { default: assert } = await import('node:assert/strict');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base);
  const app = page.frameLocator('iframe');
  await app.getByRole('button', { name: 'Explore graph', exact: true }).click();
  const search = app.getByRole('combobox', { name: 'Find work in this scope' });
  await search.fill('passkey');
  await app.getByRole('option').filter({ hasText: 'Sign in with a passkey' }).click();
  await app.getByRole('heading', { name: 'Sign in with a passkey', exact: true }).waitFor();
  await page.evaluate(() => {
    window.expanded = false;
    document.querySelector('iframe').contentWindow.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/host-context-changed',
        params: { displayMode: 'inline' },
      },
      '*',
    );
  });
  await app.locator('.graph-inline').waitFor();
  await app.getByRole('button', { name: 'Back to previous view', exact: true }).click();
  await app
    .getByRole('button', { name: 'Back to previous view', exact: true })
    .waitFor({ state: 'hidden' });
  assert(
    (await app.locator('.graph-inline-row').count()) <= 3,
    'Fullscreen history must not become an unbounded inline strip',
  );
  assert.equal(await app.locator('body').getAttribute('data-display-mode'), 'inline');
  await page.close();
}

/** Refresh and late neighborhood responses preserve the currently selected view. */
export async function verifyRefreshAndBack(browser, base, settleLayout) {
  const { default: assert } = await import('node:assert/strict');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base);
  const app = page.frameLocator('iframe');
  await app.getByRole('button', { name: 'Explore graph', exact: true }).click();
  const search = app.getByRole('combobox', { name: 'Find work in this scope' });
  await search.fill('Review team permissions');
  await app.getByRole('option').filter({ hasText: 'Review team permissions' }).click();
  await app.getByRole('heading', { name: 'Review team permissions', exact: true }).waitFor();
  await settleLayout(app);
  const camera = await app.locator('.graph-world').getAttribute('style');
  await app.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await app.getByRole('status').filter({ hasText: 'Loading' }).waitFor({ state: 'hidden' });
  assert.equal(
    await app.locator('.graph-world').getAttribute('style'),
    camera,
    'Refresh retains framing',
  );
  await app.getByRole('button', { name: 'Open neighborhood', exact: true }).click();
  await app.locator('.graph-title h1').filter({ hasText: 'Review team permissions' }).waitFor();
  await app.getByRole('button', { name: 'Relationship list', exact: true }).click();
  await app.locator('[data-graph-select="task:t04"]').click();
  await page.evaluate(() => {
    window.hold = true;
    window.pending = [];
  });
  await app.getByRole('button', { name: 'Open neighborhood', exact: true }).click();
  await page.waitForFunction(() => window.pending.length === 1);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await app.locator('.graph-title h1').filter({ hasText: 'Member portal' }).waitFor();
  await page.evaluate(() => {
    window.hold = false;
    const pending = window.pending[0];
    document.querySelector('iframe').contentWindow.postMessage(
      {
        jsonrpc: '2.0',
        id: pending.id,
        result: { structuredContent: pending.response, content: [] },
      },
      '*',
    );
  });
  await page.waitForTimeout(100);
  const callCount = await page.evaluate(() => window.calls.length);
  await app.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await page.waitForFunction((count) => window.calls.length > count, callCount);
  assert.equal(await page.evaluate(() => window.calls.at(-1).arguments.scope.kind), 'program');
  await app.locator('.graph-title h1').filter({ hasText: 'Member portal' }).waitFor();
  await page.close();
}
