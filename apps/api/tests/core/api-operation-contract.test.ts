import { Hono } from 'hono';
import { openAPIRouteHandler } from 'hono-openapi';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import {
  collectApiOperationContracts,
  operationContractForRequest,
  renderOperationNarrative,
  type ApiOperationContract,
} from '../../src/lib/api-operation-contract';
import { apiDoc } from '../../src/lib/openapi-route';
import { requireAuth } from '../../src/permissions/require-auth';
import { fakeSession, getDb, principalForSession } from '../support/routes-harness';

const ProbeOut = z.object({ ok: z.boolean().describe('Whether the probe completed.') });

const publicProbe = {
  operationId: 'getContractProbe',
  tag: 'Config',
  summary: 'Read the contract probe',
  narrative: {
    purpose: 'Confirm that one declaration controls the runtime and reference operation.',
    behavior: ['Returns one finite JSON representation without changing stored data.'],
    constraints: ['The operation accepts no parameters or request body.'],
  },
  access: { kind: 'public' },
  success: [
    {
      kind: 'json',
      status: 200,
      schema: ProbeOut,
      description: 'The probe result and its completion state.',
    },
  ],
  errors: [],
  conditionalRead: true,
  conditionalWrite: false,
  idempotency: false,
  related: [],
} as const satisfies ApiOperationContract;

const receiptProbe = {
  ...publicProbe,
  operationId: 'createContractReceiptProbe',
  summary: 'Create the contract receipt probe',
  narrative: {
    purpose: 'Verify that strict operation middleware returns an idempotent replay response.',
    behavior: ['Creates the probe once and replays its JSON response for an identical retry.'],
    constraints: ['The caller must reuse the same body with one Idempotency-Key.'],
  },
  success: [
    {
      kind: 'json',
      status: 201,
      schema: ProbeOut,
      description: 'The created probe result.',
      location: 'resource',
    },
  ],
  conditionalRead: false,
  idempotency: 'json-receipt',
} as const satisfies ApiOperationContract;

function appWithProbe(onSelected?: (contract: ApiOperationContract | undefined) => void) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    onSelected?.(operationContractForRequest(c));
    await next();
  });
  app.use('*', requireAuth);
  app.get('/probe', apiDoc(publicProbe), (c) => c.json({ ok: true }));
  app.onError(onError);
  return app;
}

function appWithMutationProbe(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth);
  app.post(
    '/probe',
    apiDoc({
      ...publicProbe,
      operationId: 'createContractProbe',
      summary: 'Create the contract probe',
      narrative: {
        purpose: 'Confirm that negative retry and concurrency declarations reject their headers.',
        behavior: ['Returns a finite probe result without persisting a resource.'],
        constraints: ['The operation accepts neither Idempotency-Key nor If-Match.'],
      },
      conditionalRead: false,
    }),
    (c) => c.json({ ok: true }),
  );
  app.onError(onError);
  return app;
}

describe('API operation contracts', () => {
  it('renders direct access, failure, and related-operation guidance', () => {
    const narrative = renderOperationNarrative({
      ...publicProbe,
      errors: ['unauthorized', 'not_found'],
    });

    expect(narrative).toContain('No workspace capability is required.');
    expect(narrative).toContain(
      '`unauthorized` (HTTP 401) — Docket could not find a valid session for this request.',
    );
    expect(narrative).toContain(
      '`not_found` (HTTP 404) — The address may be wrong, or the item may no longer be available.',
    );
    expect(narrative).toContain('## Related operations\n\nNone.');
    expect(narrative).not.toContain('Follow the recovery guidance');
    expect(narrative).not.toContain('No related operation is required');
  });

  it('returns a JSON receipt replay through the strict route middleware', async () => {
    await getDb();
    const userId = `strict-receipt-${crypto.randomUUID()}`;
    const session = fakeSession(userId);
    const principal = principalForSession(session);
    if (!principal) throw new Error('The strict receipt principal was not created.');
    const app = new Hono<AppEnv>();
    let calls = 0;
    app.use('*', async (c, next) => {
      c.set('principal', principal);
      c.set('session', session);
      await next();
    });
    app.post('/receipt', apiDoc(receiptProbe), (c) => {
      calls += 1;
      c.header('Location', 'https://api.example.test/receipt/probe_1');
      return c.json({ ok: true }, 201);
    });
    app.onError(onError);
    const key = `strict-${crypto.randomUUID()}`;
    const request = () =>
      app.request('/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: '{"ok":true}',
      });

    expect((await request()).status).toBe(201);
    const replay = await request();

    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    expect(replay.headers.get('Location')).toBe('https://api.example.test/receipt/probe_1');
    expect(await replay.json()).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it('selects route metadata before the route-local declaration executes', async () => {
    let selected: ApiOperationContract | undefined;
    const response = await appWithProbe((contract) => {
      selected = contract;
    }).request('/probe');

    expect(response.status).toBe(200);
    expect(selected).toBe(publicProbe);
  });

  it('uses the declared public access policy instead of the legacy path fallback', async () => {
    const response = await appWithProbe().request('/probe');
    expect(response.status).toBe(200);
  });

  it('enforces the successful media types declared by the operation', async () => {
    const response = await appWithProbe().request('/probe', {
      headers: { Accept: 'application/json;q=0, */*;q=1' },
    });
    expect(response.status).toBe(406);
    expect(await response.json()).toMatchObject({ code: 'not_acceptable' });
  });

  it('enforces access before route-local media negotiation', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', requireAuth);
    app.get(
      '/private-probe',
      apiDoc({
        ...publicProbe,
        operationId: 'getPrivateContractProbe',
        access: { kind: 'session-only' },
      }),
      (c) => c.json({ ok: true }),
    );
    app.onError(onError);

    const response = await app.request('/private-probe', {
      headers: { Accept: 'application/xml' },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
  });

  it.each([
    ['an undeclared success status', 'status'],
    ['a response body outside the declared output schema', 'body'],
  ] as const)('turns %s into an internal contract failure', async (_name, failure) => {
    const app = new Hono<AppEnv>();
    app.get('/probe', apiDoc(publicProbe), (c) =>
      failure === 'status' ? c.json({ ok: true }, 201) : c.json({ ok: 'not-a-boolean' }),
    );
    app.onError(onError);

    const response = await app.request('/probe');

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'internal', status: 500 });
  });

  it('requires a declared monitor Location on the response that actually returns 202', async () => {
    const app = new Hono<AppEnv>();
    app.post(
      '/probe',
      apiDoc({
        ...publicProbe,
        operationId: 'queueContractProbe',
        summary: 'Queue the contract probe',
        conditionalRead: false,
        success: [
          {
            kind: 'json',
            status: 202,
            schema: ProbeOut,
            description: 'The accepted probe and its monitor.',
            location: 'monitor',
          },
        ],
      }),
      (c) => c.json({ ok: true }, 202),
    );
    app.onError(onError);

    const response = await app.request('/probe', { method: 'POST' });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'internal', status: 500 });
  });

  it.each([
    ['Idempotency-Key', 'retry-once'],
    ['If-Match', '"stale"'],
  ])('rejects an unsupported %s before the handler executes', async (header, value) => {
    const response = await appWithMutationProbe().request('/probe', {
      method: 'POST',
      headers: { [header]: value },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'validation_error' });
  });

  it('collects one operation from the same metadata installed on the route', () => {
    expect(collectApiOperationContracts(appWithProbe())).toEqual([
      { method: 'GET', path: '/probe', contract: publicProbe },
    ]);
  });

  it('renders structured prose, a stable operation id, and exact success metadata', async () => {
    const api = appWithProbe();
    const docs = new Hono().get(
      '/openapi.json',
      openAPIRouteHandler(api, {
        documentation: {
          info: { title: 'Fixture', version: '0.1.0', description: 'Fixture document.' },
        },
      }),
    );
    const document = (await (await docs.request('/openapi.json')).json()) as {
      paths: Record<
        string,
        Record<
          string,
          {
            operationId: string;
            tags: string[];
            description: string;
            responses: Record<string, { description: string }>;
          }
        >
      >;
    };
    const operation = document.paths['/probe']?.['get'];
    expect(operation).toMatchObject({
      operationId: 'getContractProbe',
      tags: ['Config'],
      responses: { '200': { description: 'The probe result and its completion state.' } },
    });
    expect(operation?.description).toContain('## Purpose');
    expect(operation?.description).toContain('## Inputs and constraints');
    expect(operation?.description).toContain('## Result and side effects');
    expect(operation?.description).toContain('## Access and permissions');
    expect(operation?.description).toContain('## Failures and recovery');
    expect(operation?.description).toContain('## Related operations');
    expect(operation?.description).not.toContain('Success.');
  });

  it('publishes each SSE event payload schema and literal wire example in OpenAPI', async () => {
    const eventPayload = z.object({ sequence: z.number().int() });
    const api = new Hono<AppEnv>().get(
      '/events',
      apiDoc({
        ...publicProbe,
        operationId: 'streamContractEvents',
        summary: 'Stream contract events',
        conditionalRead: false,
        success: [
          {
            kind: 'sse',
            status: 200,
            events: [
              {
                name: 'progress',
                description: 'One progress update.',
                schema: eventPayload,
                example: 'event: progress\ndata: {"sequence":1}\n\n',
              },
            ],
            resume: {
              kind: 'last-event-id',
              header: 'Last-Event-ID',
              replayWindow: 'The latest 100 events.',
              description: 'Resume after a received event id.',
            },
            description: 'Progress as Server-Sent Events.',
          },
        ],
      }),
      () => new Response(),
    );
    const docs = new Hono().get(
      '/openapi.json',
      openAPIRouteHandler(api, {
        documentation: {
          info: { title: 'Fixture', version: '0.1.0', description: 'Fixture document.' },
        },
      }),
    );

    const document = (await (await docs.request('/openapi.json')).json()) as {
      paths: Record<
        string,
        {
          get?: {
            parameters?: readonly {
              name: string;
              in: string;
              description: string;
            }[];
            responses: Record<
              string,
              {
                content?: Record<
                  string,
                  {
                    'x-docket-events'?: readonly {
                      name: string;
                      description: string;
                      schema: unknown;
                      example: string;
                    }[];
                  }
                >;
              }
            >;
          };
        }
      >;
    };
    const events =
      document.paths['/events']?.get?.responses['200']?.content?.['text/event-stream']?.[
        'x-docket-events'
      ];

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      name: 'progress',
      description: 'One progress update.',
      example: 'event: progress\ndata: {"sequence":1}\n\n',
      schema: { type: 'object' },
    });
    expect(document.paths['/events']?.get?.parameters).toEqual([
      expect.objectContaining({
        name: 'Last-Event-ID',
        in: 'header',
        description: expect.stringContaining('latest 100 events'),
      }),
    ]);
  });

  it('rejects a structurally empty declaration at route registration', () => {
    expect(() =>
      apiDoc({
        ...publicProbe,
        operationId: '',
        narrative: { purpose: '', behavior: [] },
        success: [],
      }),
    ).toThrow(/operationId/);
  });
});
