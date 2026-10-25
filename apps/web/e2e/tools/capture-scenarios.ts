import { addVirtualAuthenticator } from '../helpers/webauthn';
import type { Locator, Page } from '@playwright/test';
import { z } from 'zod';

import { assertLocalCaptureBaseUrl } from './capture-policy';

const targetSchema = z
  .object({
    role: z.string().min(1).optional(),
    name: z.string().optional(),
    label: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    exact: z.boolean().default(true),
    index: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (target) =>
      [target.role, target.label, target.text, target.testId, target.selector].filter(
        (value) => value !== undefined,
      ).length === 1,
    'A target must use exactly one of role, label, text, testId, or selector',
  );

const captureRequestFields = {
  url: z.string().regex(/^\/(?!\/)/),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  body: z.unknown().optional(),
};

const pointSchema = z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }).strict();

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reload') }).strict(),
  z
    .object({
      action: z.literal('click'),
      target: targetSchema,
      modifiers: z.array(z.enum(['Shift', 'Control', 'Meta', 'Alt'])).optional(),
      button: z.enum(['left', 'middle', 'right']).optional(),
      position: pointSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('drag'),
      source: targetSchema,
      target: targetSchema,
      sourcePosition: pointSchema.optional(),
      targetPosition: pointSchema.optional(),
    })
    .strict(),
  z.object({ action: z.literal('request'), ...captureRequestFields }).strict(),
  z.object({ action: z.literal('dialog'), response: z.enum(['accept', 'dismiss']) }).strict(),
  z.object({ action: z.literal('fill'), target: targetSchema, value: z.string() }).strict(),
  z.object({ action: z.literal('select'), target: targetSchema, value: z.string() }).strict(),
  z.object({ action: z.literal('press'), target: targetSchema, key: z.string().min(1) }).strict(),
  z.object({ action: z.literal('check'), target: targetSchema, checked: z.boolean() }).strict(),
  z.object({ action: z.literal('scroll'), target: targetSchema }).strict(),
  z
    .object({
      action: z.literal('wait'),
      target: targetSchema,
      state: z.enum(['visible', 'hidden', 'attached', 'detached']).default('visible'),
    })
    .strict(),
]);

const mockSchema = z
  .object({
    url: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    response: z
      .object({ status: z.number().int().min(100).max(599), json: z.unknown().optional() })
      .strict()
      .optional(),
    hold: z.literal(true).optional(),
    times: z.number().int().positive().optional(),
    skip: z.number().int().nonnegative().default(0),
  })
  .strict()
  .refine((mock) => (mock.hold === true) !== (mock.response !== undefined), {
    message: 'A mock must have exactly one of response or hold',
  });

const scenarioSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
    route: z.string().regex(/^\/(?!\/)/),
    authenticated: z.boolean().optional(),
    virtualAuthenticator: z.boolean().optional(),
    credentialResponse: z.literal('cancel').optional(),
    textScale: z.union([z.literal(1), z.literal(2)]).optional(),
    actions: z.array(actionSchema).default([]),
    ready: targetSchema.optional(),
    allowState: z.enum(['loading', 'error']).optional(),
    mocks: z.array(mockSchema).default([]),
    fixtureRequests: z
      .array(
        z
          .object({
            ...captureRequestFields,
            saveAs: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

/** A named, reproducible UI state captured by the standard responsive screenshot tool. */
export type CaptureScenario = z.infer<typeof scenarioSchema>;
/** A single declarative locator; executable browser code is never accepted in scenario input. */
export type CaptureTarget = z.infer<typeof targetSchema>;

/** Validate scenario records and reject ambiguous filenames or executable/unknown instructions. */
export function parseCaptureScenarios(input: unknown): CaptureScenario[] {
  const scenarios = z.array(scenarioSchema).min(1).parse(input);
  if (new Set(scenarios.map(({ id }) => id)).size !== scenarios.length) {
    throw new Error('Capture scenario ids must be unique');
  }
  return scenarios;
}

/** Resolve a declarative target through Playwright's accessible locators. */
export function captureTarget(page: Page, target: CaptureTarget): Locator {
  const { exact, index } = target;
  let locator: Locator;
  if (target.role !== undefined) {
    locator = page.getByRole(target.role as Parameters<Page['getByRole']>[0], {
      ...(target.name === undefined ? {} : { name: target.name }),
      exact,
    });
  } else if (target.label !== undefined) locator = page.getByLabel(target.label, { exact });
  else if (target.text !== undefined) locator = page.getByText(target.text, { exact });
  else if (target.testId !== undefined) locator = page.getByTestId(target.testId);
  else locator = page.locator(target.selector ?? '');
  return index === undefined ? locator : locator.nth(index);
}

type CaptureAction = CaptureScenario['actions'][number];
type TargetCaptureAction = Extract<CaptureAction, { target: CaptureTarget }>;
type PageCaptureAction = Exclude<CaptureAction, TargetCaptureAction>;

/** Apply ordered user interactions, then wait for the state's explicitly named readiness target. */
export async function applyCaptureScenario(page: Page, scenario: CaptureScenario): Promise<void> {
  for (const action of scenario.actions) {
    if ('target' in action) await applyTargetCaptureAction(page, action);
    else await applyPageCaptureAction(page, action);
  }
  if (scenario.ready) await captureTarget(page, scenario.ready).waitFor({ state: 'visible' });
}

async function applyPageCaptureAction(page: Page, action: PageCaptureAction): Promise<void> {
  switch (action.action) {
    case 'reload':
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
      break;
    case 'dialog':
      page.once('dialog', async (dialog) => {
        if (action.response === 'accept') await dialog.accept();
        else await dialog.dismiss();
      });
      break;
    case 'request':
      await fetchCaptureRequest(page, action);
      break;
  }
}

async function applyTargetCaptureAction(page: Page, action: TargetCaptureAction): Promise<void> {
  const locator = captureTarget(page, action.target);
  switch (action.action) {
    case 'click':
      await clickCaptureTarget(locator, action);
      break;
    case 'drag':
      await captureTarget(page, action.source).dragTo(locator, {
        ...(action.sourcePosition ? { sourcePosition: action.sourcePosition } : {}),
        ...(action.targetPosition ? { targetPosition: action.targetPosition } : {}),
      });
      break;
    case 'fill':
      await locator.fill(action.value);
      break;
    case 'select':
      await locator.selectOption(action.value);
      break;
    case 'press':
      await locator.press(action.key);
      break;
    case 'check':
      await locator.setChecked(action.checked);
      break;
    case 'scroll':
      await locator.waitFor({ state: 'visible' });
      await locator.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
      break;
    case 'wait':
      await locator.waitFor({ state: action.state });
      break;
  }
}

async function clickCaptureTarget(
  locator: Locator,
  action: Extract<TargetCaptureAction, { action: 'click' }>,
): Promise<void> {
  await locator.click({
    ...(action.modifiers ? { modifiers: action.modifiers } : {}),
    ...(action.button ? { button: action.button } : {}),
    ...(action.position ? { position: action.position } : {}),
  });
}

/** Install clearly declared local request faults before navigation, preserving normal requests. */
export async function installCaptureMocks(page: Page, scenario: CaptureScenario): Promise<void> {
  for (const mock of scenario.mocks) {
    let uses = 0;
    let skipped = 0;
    await page.route(mock.url, async (route) => {
      if (route.request().method() !== mock.method || (mock.times && uses >= mock.times)) {
        await route.fallback();
        return;
      }
      if (skipped < mock.skip) {
        skipped += 1;
        await route.fallback();
        return;
      }
      uses += 1;
      if (mock.hold) {
        await new Promise<void>((release) =>
          page.once('close', () => {
            release();
          }),
        );
        await route.abort().catch(() => undefined);
      } else if (mock.response) {
        await route.fulfill({
          status: mock.response.status,
          contentType: 'application/json',
          body: JSON.stringify(mock.response.json ?? {}),
        });
      }
    });
  }
}

/** Substitute fixture response fields without evaluating code or accepting missing values. */
export function substituteCaptureValues<T>(value: T, values: Record<string, unknown>): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_token, path: string) => {
      let field: unknown = values;
      for (const segment of path.split('.')) {
        if (typeof field !== 'object' || field === null || !Object.hasOwn(field, segment)) {
          throw new Error(`Capture fixture value missing: ${path}`);
        }
        field = (field as Record<string, unknown>)[segment];
      }
      if (typeof field !== 'string' && typeof field !== 'number') {
        throw new Error(`Capture fixture value is not scalar: ${path}`);
      }
      return String(field);
    }) as T;
  }
  if (Array.isArray(value))
    return (value as unknown[]).map((entry) => substituteCaptureValues(entry, values)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substituteCaptureValues(entry, values)]),
    ) as T;
  }
  return value;
}

/** Create isolated local records before each frame so transient states can be replayed honestly. */
export async function prepareCaptureScenario(
  page: Page,
  scenario: CaptureScenario,
): Promise<CaptureScenario> {
  if (scenario.fixtureRequests.length === 0) return scenario;
  const values: Record<string, unknown> = {};
  for (const fixture of scenario.fixtureRequests) {
    const request = substituteCaptureValues(fixture, values);
    values[request.saveAs] = await fetchCaptureRequest(page, request);
  }
  return substituteCaptureValues({ ...scenario, fixtureRequests: [] }, values);
}

async function fetchCaptureRequest(
  page: Page,
  request: z.infer<z.ZodObject<typeof captureRequestFields>>,
): Promise<unknown> {
  const baseURL = process.env['API_URL'];
  if (!baseURL) throw new Error('Capture requests require the standard dev-stack API_URL');
  assertLocalCaptureBaseUrl(baseURL);
  const response = await page.request.fetch(`${baseURL}${request.url}`, {
    method: request.method,
    ...(request.body === undefined ? {} : { data: request.body }),
  });
  if (!response.ok())
    throw new Error(`Capture request ${request.url} failed: HTTP ${String(response.status())}`);
  if (response.status() === 204) return null;
  const body: unknown = await response.json();
  return body;
}

/** Install explicitly requested local device/text fixtures in the canonical capture path. */
export async function prepareCaptureEnvironment(
  page: Page,
  scenario?: CaptureScenario,
): Promise<void> {
  if (!scenario) return;
  if (scenario.virtualAuthenticator) await addVirtualAuthenticator(page);
  if (!scenario.textScale && !scenario.credentialResponse) return;
  if (scenario.credentialResponse === 'cancel')
    await page.addInitScript({
      // A literal avoids tsx's keep-names helper escaping into the browser function body.
      content:
        "Object.defineProperty(navigator.credentials, 'create', { configurable: true, value: function () { return Promise.reject(new DOMException('Controlled local cancellation', 'NotAllowedError')); } });",
    });
  if (scenario.textScale !== 2) return;
  await page.addInitScript(() => {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        document.documentElement.style.fontSize = '200%';
      },
      { once: true },
    );
  });
}
