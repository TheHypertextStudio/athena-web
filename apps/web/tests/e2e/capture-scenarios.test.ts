import type { Page, Route } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseCaptureArgs } from '../../e2e/tools/capture-cli';
import {
  applyCaptureScenario,
  installCaptureMocks,
  parseCaptureScenarios,
  substituteCaptureValues,
} from '../../e2e/tools/capture-scenarios';

describe('named screenshot states', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches modifier selection and real locator drags in order', async () => {
    const click = vi.fn(async () => undefined);
    const dragTo = vi.fn(async () => undefined);
    const source = { click, dragTo };
    const destination = {};
    const page = {
      getByTestId: (id: string) => (id === 'source' ? source : destination),
    } as unknown as Page;
    const [scenario] = parseCaptureScenarios([
      {
        id: 'multi-and-drag',
        route: '/plan',
        actions: [
          {
            action: 'click',
            target: { testId: 'source' },
            modifiers: ['Shift'],
            button: 'right',
            position: { x: 5, y: 10 },
          },
          {
            action: 'drag',
            source: { testId: 'source' },
            target: { testId: 'destination' },
            sourcePosition: { x: 10, y: 10 },
            targetPosition: { x: 100, y: 100 },
          },
        ],
      },
    ]);
    if (!scenario) throw new Error('Scenario missing');
    await applyCaptureScenario(page, scenario);
    expect(click).toHaveBeenCalledWith({
      modifiers: ['Shift'],
      button: 'right',
      position: { x: 5, y: 10 },
    });
    expect(dragTo).toHaveBeenCalledWith(destination, {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 100, y: 100 },
    });
    expect(click.mock.invocationCallOrder[0]).toBeLessThan(dragTo.mock.invocationCallOrder[0] ?? 0);
  });

  it('uses the guarded local API for post-render requests and rejects remote origins', async () => {
    const fetch = vi.fn(async () => ({
      ok: () => true,
      status: () => 200,
      json: async () => ({ revision: 2 }),
    }));
    const page = { request: { fetch } } as unknown as Page;
    const [scenario] = parseCaptureScenarios([
      {
        id: 'remote-change',
        route: '/plan',
        actions: [
          { action: 'request', url: '/v1/me/plans/123', method: 'PATCH', body: { revision: 1 } },
        ],
      },
    ]);
    if (!scenario) throw new Error('Scenario missing');
    vi.stubEnv('API_URL', 'http://api.docket.localhost:1828');
    await applyCaptureScenario(page, scenario);
    expect(fetch).toHaveBeenCalledWith('http://api.docket.localhost:1828/v1/me/plans/123', {
      method: 'PATCH',
      data: { revision: 1 },
    });
    vi.stubEnv('API_URL', 'https://production.example');
    await expect(applyCaptureScenario(page, scenario)).rejects.toThrow('non-local');
    expect(fetch).toHaveBeenCalledOnce();
    for (const action of [
      { action: 'click', target: { testId: 'node' }, modifiers: ['CapsLock'] },
      {
        action: 'drag',
        source: { testId: 'node' },
        target: { testId: 'node' },
        sourcePosition: { x: -1, y: 0 },
      },
      { action: 'request', url: '//evil.example/path', method: 'POST' },
      { action: 'request', url: 'https://evil.example/path', method: 'POST' },
    ])
      expect(() =>
        parseCaptureScenarios([{ id: 'invalid', route: '/plan', actions: [action] }]),
      ).toThrow();
  });

  it('centers a visible scroll target even when it is already partially in view', async () => {
    const scrollIntoView = vi.fn();
    const waitFor = vi.fn(async () => undefined);
    const evaluate = vi.fn((callback: (element: Element) => void) => {
      callback({ scrollIntoView } as unknown as Element);
    });
    const page = { getByLabel: () => ({ waitFor, evaluate }) } as unknown as Page;
    const [scenario] = parseCaptureScenarios([
      {
        id: 'due-controls',
        route: '/plan',
        actions: [{ action: 'scroll', target: { label: 'Due date rule' } }],
      },
    ]);
    if (!scenario) throw new Error('Scenario missing');
    await applyCaptureScenario(page, scenario);
    expect(waitFor).toHaveBeenCalledWith({ state: 'visible' });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    expect(waitFor.mock.invocationCallOrder[0]).toBeLessThan(
      evaluate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('accepts a declarative reload and rejects executable reload options', () => {
    expect(
      parseCaptureScenarios([
        { id: 'restored', route: '/plan', actions: [{ action: 'reload' }] },
      ])[0]?.actions,
    ).toEqual([{ action: 'reload' }]);
    expect(() =>
      parseCaptureScenarios([
        { id: 'restored', route: '/plan', actions: [{ action: 'reload', script: 'alert(1)' }] },
      ]),
    ).toThrow();
  });
  it('skips only matching requests and limits intercepted outcomes after the skip', async () => {
    let handler: ((route: Route) => Promise<void>) | undefined;
    const page = {
      route: async (_url: string, callback: (route: Route) => Promise<void>): Promise<void> => {
        handler = callback;
      },
    } as unknown as Page;
    const [scenario] = parseCaptureScenarios([
      {
        id: 'second-request',
        route: '/plan',
        mocks: [
          { url: '**/preview', method: 'POST', skip: 1, times: 1, response: { status: 503 } },
        ],
      },
    ]);
    if (!scenario) throw new Error('Scenario missing');
    await installCaptureMocks(page, scenario);
    let method = 'GET';
    const fallback = vi.fn(async () => undefined);
    const fulfill = vi.fn(async () => undefined);
    const route = {
      request: () => ({ method: () => method }),
      fallback,
      fulfill,
    } as unknown as Route;
    if (!handler) throw new Error('Handler missing');
    await handler(route);
    method = 'POST';
    await handler(route);
    await handler(route);
    await handler(route);
    expect(fallback).toHaveBeenCalledTimes(3);
    expect(fulfill).toHaveBeenCalledOnce();
    expect(fulfill).toHaveBeenCalledWith({
      status: 503,
      contentType: 'application/json',
      body: '{}',
    });
  });

  it('keeps batch flags out of route lists and preserves explicit failure artifacts', () => {
    const options = parseCaptureArgs([
      '--continue-on-error',
      '--failures=/tmp/failed.jsonl',
      '/plan',
    ]);
    expect(options.continueOnError).toBe(true);
    expect(options.failures).toBe('/tmp/failed.jsonl');
    expect(options.routes).toEqual(['/plan']);
    expect(parseCaptureArgs(['--scenarios=/tmp/states.json']).routes).toEqual([]);
  });
  it('substitutes only owned scalar fixture properties', () => {
    expect(
      substituteCaptureValues(
        { route: '/plans/{{plan.data.id}}', count: 1 },
        { plan: { data: { id: '123' } } },
      ),
    ).toEqual({ route: '/plans/123', count: 1 });
    expect(() => substituteCaptureValues('{{plan.missing}}', { plan: {} })).toThrow('missing');
    expect(() => substituteCaptureValues('{{plan.toString}}', { plan: {} })).toThrow('missing');
    expect(() => substituteCaptureValues('{{plan.data}}', { plan: { data: {} } })).toThrow(
      'not scalar',
    );
  });
  it('retains ordered actions and deliberate failure/loading declarations', () => {
    const [scenario] = parseCaptureScenarios([
      {
        id: 'save-failed',
        route: '/orgs/:orgId/work-templates/new',
        actions: [
          { action: 'fill', target: { label: 'Name' }, value: 'Event' },
          { action: 'click', target: { role: 'button', name: 'Save' } },
        ],
        ready: { role: 'alert' },
        allowState: 'error',
        mocks: [{ method: 'POST', url: '**/api/v1/templates', skip: 1, response: { status: 503 } }],
      },
    ]);
    expect(scenario?.actions.map(({ action }) => action)).toEqual(['fill', 'click']);
    const first = scenario?.actions[0];
    expect(first && 'target' in first ? first.target.exact : undefined).toBe(true);
    expect(scenario?.allowState).toBe('error');
    expect(scenario?.mocks[0]?.skip).toBe(1);
  });

  const invalidScenarios = [
    [{ id: '../escape', route: '/today' }],
    [{ id: 'external', route: '//example.com' }],
    [
      { id: 'duplicate', route: '/today' },
      { id: 'duplicate', route: '/plan' },
    ],
    [{ id: 'eval', route: '/today', actions: [{ action: 'evaluate', code: 'alert(1)' }] }],
    [{ id: 'ambiguous', route: '/today', ready: { role: 'button', label: 'Name' } }],
    [{ id: 'unknown', route: '/today', actions: [], script: 'malicious' }],
    [{ id: 'mock', route: '/today', mocks: [{ method: 'GET', url: '**/api/**' }] }],
    [
      {
        id: 'both',
        route: '/today',
        mocks: [{ method: 'GET', url: '**', hold: true, response: { status: 500 } }],
      },
    ],
  ];
  it.each(invalidScenarios.map((input) => ({ input })))(
    'rejects unsafe or ambiguous input %#',
    ({ input }) => {
      expect(() => parseCaptureScenarios(input)).toThrow();
    },
  );

  it('accepts explicit loading and native form interactions without executable code', () => {
    expect(
      parseCaptureScenarios([
        {
          id: 'loading',
          route: '/plan',
          allowState: 'loading',
          mocks: [{ method: 'GET', url: '**/api/v1/plans*', hold: true }],
          actions: [
            { action: 'select', target: { label: 'Kind' }, value: 'task' },
            { action: 'press', target: { role: 'textbox', name: 'Search' }, key: 'Escape' },
            { action: 'wait', target: { selector: '[data-slot="skeleton"]' } },
          ],
        },
      ])[0]?.mocks[0]?.hold,
    ).toBe(true);
  });
});
