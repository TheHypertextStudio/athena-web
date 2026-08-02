/**
 * `pnpm --filter @docket/web exec tsx e2e/tools/credential-masking-probe.ts` — evidence capture for
 * credential masking on the connector surface (GEN-07).
 *
 * @remarks
 * GEN-07 asks for three things about every settings surface that stores a credential: screenshots
 * at 1440x900 and 390x844 in light and dark showing the value masked, a network capture with no
 * full key in any response body, and server logs with no key material. This tool produces the
 * first two; the log search is a `grep` over the dev-stack log for the same probe token, run
 * alongside it and recorded in the audit.
 *
 * It drives the browser as a signed-in user (storage state from {@link file://./dev-session.ts}),
 * opens Settings → Athena, and does two things:
 *
 * 1. **Stores a connector.** `authMode: 'none'` is used because the local dev stack does not set
 *    `CREDENTIALS_ENCRYPTION_KEY`, and `sealCredential` refuses (409) to store a bearer credential
 *    without it. The stored row still proves the list contract: `McpIntegrationOut` carries no
 *    credential field at all, so a connector that exists on the server renders with nothing secret
 *    on screen. The bearer-credential-at-rest half is proved separately by
 *    `apps/api/tests/security/credential-masking.test.ts`, which can configure the sealing key.
 * 2. **Types a real credential into the bearer field** and screenshots the open dialog at both
 *    viewports and both color schemes, so the masking of an entered credential is photographed
 *    rather than asserted.
 *
 * Every HTTP response the page receives throughout — including the create round trip that carries
 * the credential in its request body — is recorded and searched for the probe token, as are the
 * rendered DOM text and every `localStorage`/`sessionStorage` value.
 *
 * Usage (from `apps/web`):
 *   tsx e2e/tools/credential-masking-probe.ts --session=<path> --out=<dir> [--token=<value>]
 */
import { chromium } from '@playwright/test';
import type { BrowserContext, Locator, Page, Response } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A recorded HTTP response, reduced to what the leak search needs. */
interface CapturedResponse {
  /** Whether the body contained the probe token verbatim. */
  readonly containsToken: boolean;
  /** Response body length in characters (0 when the body could not be replayed). */
  readonly length: number;
  /** HTTP status. */
  readonly status: number;
  /** Absolute request URL. */
  readonly url: string;
}

/** The evidence report this tool writes next to the screenshots. */
interface ProbeReport {
  /** ISO timestamp the probe finished. */
  readonly capturedAt: string;
  /** `type` attribute of the bearer-token field, read from the live DOM. */
  readonly bearerFieldType: string;
  /** Whether the typed credential is readable in the field's rendered pixels. */
  readonly bearerFieldMasked: boolean;
  /** Outcome of storing a bearer-credential connector against this stack. */
  readonly bearerStoreOutcome: string;
  /** Visible text of the connected-tools list after a connector was stored. */
  readonly connectedToolsText: string;
  /** Whether this run created the uncredentialed connector or found it already stored. */
  readonly storedConnectorOutcome: 'created' | 'existing';
  /** Screenshot file names written, in capture order. */
  readonly screenshots: readonly string[];
  /** Responses whose body contained the probe token. */
  readonly leakingResponses: readonly CapturedResponse[];
  /** Every response observed, in arrival order. */
  readonly responses: readonly CapturedResponse[];
  /** The MCP endpoint the connectors were pointed at. */
  readonly serverUrl: string;
  /** Whether the probe token appeared anywhere in the rendered page text. */
  readonly tokenInRenderedText: boolean;
  /** Whether the probe token appeared in `localStorage` or `sessionStorage`. */
  readonly tokenInWebStorage: boolean;
  /** The probe token used, so the log search can be reproduced. */
  readonly token: string;
}

/** The fixture MCP host `MockMcpConnector` serves in `APP_MODE=local`. */
const SERVER_URL = 'https://mcp.sunsama.com/mcp';

/** Tool prefix for the connector stored without a credential. */
const STORED_ALIAS = 'sunsama';

/** Tool prefix for the bearer attempt, kept distinct so neither create collides with the other. */
const BEARER_ALIAS = 'probebearer';

/** How long to wait for a UI transition before giving up, in milliseconds. */
const STEP_TIMEOUT = 20_000;

/** The design-review standard shot set: two viewports x two color schemes. */
const VIEWPORTS = [
  { height: 900, label: '1440x900', width: 1440 },
  { height: 844, label: '390x844', width: 390 },
] as const;
const COLOR_SCHEMES = ['light', 'dark'] as const;

interface SessionMeta {
  readonly baseURL: string;
}

interface CliArgs {
  readonly outDir: string;
  readonly session: string;
  readonly token: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match?.[1] !== undefined && match[2] !== undefined) flags.set(match[1], match[2]);
  }
  const session = flags.get('session');
  const out = flags.get('out');
  if (session === undefined || out === undefined) {
    throw new Error(
      'credential-masking-probe: pass --session=<storage-state.json> and --out=<dir>',
    );
  }
  return {
    outDir: resolve(out),
    session: resolve(session),
    token: flags.get('token') ?? `dkt_probe_${Math.random().toString(36).slice(2, 14)}`,
  };
}

/** Read the base URL the session was minted against. */
function readBaseUrl(sessionPath: string): string {
  const meta = JSON.parse(readFileSync(`${sessionPath}.meta.json`, 'utf8')) as SessionMeta;
  return meta.baseURL;
}

/** Expand a `<details>` disclosure by its summary text, if it is not already open. */
async function expandDisclosure(scope: Locator | Page, summaryText: string): Promise<void> {
  const summary = scope.getByText(summaryText, { exact: true }).first();
  await summary.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  const open = await summary.evaluate((node) => node.closest('details')?.hasAttribute('open'));
  if (open !== true) await summary.click();
}

/**
 * Open the connector dialog and fill the shared fields.
 *
 * @remarks
 * Every locator is scoped to the dialog. The connected-tools list renders its own inline "Tool
 * prefix" editor per stored row, so an unscoped lookup matches two elements once a connector
 * exists.
 *
 * @param page - The page showing Settings -> Athena.
 * @param alias - Tool prefix to give this connector; must be unique within the workspace.
 * @returns The dialog locator, for the caller's remaining field interactions.
 */
async function openConnectorForm(page: Page, alias: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add connector' }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

  const url = dialog.getByLabel('Server URL');
  await url.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  await url.fill(SERVER_URL);
  await url.blur();

  const name = dialog.getByLabel('Name', { exact: true });
  await name.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  if ((await name.inputValue()).trim() === '') await name.fill('Probe Connector');

  await expandDisclosure(dialog, 'Advanced options');
  await dialog.getByLabel('Tool prefix').fill(alias);
  return dialog;
}

/**
 * Store a connector that needs no credential, so a real stored row appears in the list.
 *
 * @remarks
 * Idempotent across runs: the alias is unique per workspace, so a second run is rejected with the
 * generic conflict copy. That is the desired end state either way — a stored connector exists —
 * so the dialog is simply dismissed rather than treated as a failure.
 *
 * @param page - The page showing Settings -> Athena.
 * @returns Whether this run created the row (`created`) or found it already there (`existing`).
 */
async function storeUncredentialedConnector(page: Page): Promise<'created' | 'existing'> {
  const dialog = await openConnectorForm(page, STORED_ALIAS);
  await expandDisclosure(dialog, 'Other connection methods');
  await dialog.getByLabel('Connection method').selectOption('none');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  try {
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    return 'created';
  } catch {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT }).catch(() => undefined);
    return 'existing';
  }
}

/** Type a credential into the bearer field and try to store it; report what the server said. */
async function enterBearerCredential(page: Page, token: string): Promise<string> {
  const dialog = await openConnectorForm(page, BEARER_ALIAS);
  await expandDisclosure(dialog, 'Other connection methods');
  await dialog.getByLabel('Connection method').selectOption('bearer');
  const bearer = dialog.getByLabel('Bearer token');
  await bearer.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  await bearer.fill(token);

  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  const alert = dialog.getByRole('alert').first();
  try {
    await alert.waitFor({ state: 'visible', timeout: 10_000 });
    return `rejected: ${(await alert.innerText()).trim()}`;
  } catch {
    return 'stored';
  }
}

/** Capture the standard shot set of the currently open dialog. */
async function captureShotSet(
  context: BrowserContext,
  baseURL: string,
  token: string,
  outDir: string,
): Promise<string[]> {
  const written: string[] = [];
  for (const scheme of COLOR_SCHEMES) {
    for (const viewport of VIEWPORTS) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      await page.goto(`${baseURL}/settings/athena`, { waitUntil: 'networkidle' });
      const dialog = await openConnectorForm(page, BEARER_ALIAS);
      await expandDisclosure(dialog, 'Other connection methods');
      await dialog.getByLabel('Connection method').selectOption('bearer');
      await dialog.getByLabel('Bearer token').fill(token);
      await page.waitForTimeout(250);
      const file = `connector-bearer-${viewport.label}-${scheme}.png`;
      await page.screenshot({ fullPage: true, path: resolve(outDir, file) });
      written.push(file);
      await page.close();
    }
  }
  return written;
}

/**
 * Capture the standard shot set of the STORED connector row with its details expanded.
 *
 * @remarks
 * The complement to {@link captureShotSet}: that one photographs a credential being entered, this
 * one photographs everything the surface shows about a connection that already exists on the
 * server. Nothing credential-shaped may appear here — `McpIntegrationOut` has no token field, so
 * there is nothing for the row to render even if it wanted to.
 *
 * @param context - The signed-in browser context.
 * @param baseURL - Origin of the running web app.
 * @param outDir - Directory the PNGs are written to.
 * @returns The file names written, in capture order.
 */
async function captureStoredConnectorShots(
  context: BrowserContext,
  baseURL: string,
  outDir: string,
): Promise<string[]> {
  const written: string[] = [];
  for (const scheme of COLOR_SCHEMES) {
    for (const viewport of VIEWPORTS) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      await page.goto(`${baseURL}/settings/athena`, { waitUntil: 'networkidle' });
      await expandDisclosure(page, 'Connection details');
      await page.waitForTimeout(250);
      const file = `stored-connector-${viewport.label}-${scheme}.png`;
      await page.screenshot({ fullPage: true, path: resolve(outDir, file) });
      written.push(file);
      await page.close();
    }
  }
  return written;
}

async function main(): Promise<void> {
  const { outDir, session, token } = parseArgs(process.argv.slice(2));
  const baseURL = readBaseUrl(session);
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: session,
    viewport: { height: 900, width: 1440 },
  });

  const responses: CapturedResponse[] = [];
  const record = async (response: Response): Promise<void> => {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // Streaming or aborted bodies cannot be replayed; recorded with length 0.
    }
    responses.push({
      containsToken: body.includes(token),
      length: body.length,
      status: response.status(),
      url: response.url(),
    });
  };
  context.on('response', (response) => {
    void record(response);
  });

  const page = await context.newPage();
  await page.goto(`${baseURL}/settings/athena`, { waitUntil: 'networkidle' });
  await page
    .getByRole('button', { name: 'Add connector' })
    .first()
    .waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

  const storedConnectorOutcome = await storeUncredentialedConnector(page);
  await page.goto(`${baseURL}/settings/athena`, { waitUntil: 'networkidle' });
  const connectedToolsText = (
    await page
      .getByRole('list')
      .first()
      .innerText()
      .catch(() => '')
  ).trim();

  const bearerStoreOutcome = await enterBearerCredential(page, token);
  const bearerFieldType = await page
    .getByRole('dialog')
    .first()
    .getByLabel('Bearer token')
    .getAttribute('type');
  const bearerFieldMasked = bearerFieldType === 'password';

  const screenshots = [
    ...(await captureShotSet(context, baseURL, token, outDir)),
    ...(await captureStoredConnectorShots(context, baseURL, outDir)),
  ];

  const renderedText = await page.locator('body').innerText();
  // Written without an inner named function on purpose: the tsx/esbuild transform injects a
  // `__name` helper for those, which does not exist in the page's realm and throws at evaluate.
  const tokenInWebStorage = await page.evaluate(
    (probe) =>
      [window.localStorage, window.sessionStorage].some((storage) =>
        Object.keys(storage).some((key) => (storage.getItem(key) ?? '').includes(probe)),
      ),
    token,
  );

  await page.waitForTimeout(500);
  await browser.close();

  const payload: ProbeReport = {
    bearerFieldMasked,
    bearerFieldType: bearerFieldType ?? 'unknown',
    bearerStoreOutcome,
    capturedAt: new Date().toISOString(),
    connectedToolsText,
    storedConnectorOutcome,
    leakingResponses: responses.filter((response) => response.containsToken),
    responses,
    screenshots,
    serverUrl: SERVER_URL,
    token,
    tokenInRenderedText: renderedText.includes(token),
    tokenInWebStorage,
  };

  writeFileSync(resolve(outDir, 'probe-report.json'), `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`[credential-masking-probe] token=${token}`);
  console.log(`[credential-masking-probe] bearer field type: ${payload.bearerFieldType}`);
  console.log(`[credential-masking-probe] bearer store outcome: ${bearerStoreOutcome}`);
  console.log(`[credential-masking-probe] responses captured: ${String(responses.length)}`);
  console.log(
    `[credential-masking-probe] responses containing the token: ${String(payload.leakingResponses.length)}`,
  );
  console.log(
    `[credential-masking-probe] token in rendered text: ${String(payload.tokenInRenderedText)}`,
  );
  console.log(`[credential-masking-probe] token in web storage: ${String(tokenInWebStorage)}`);
  console.log(`[credential-masking-probe] out: ${outDir}`);
}

await main();
