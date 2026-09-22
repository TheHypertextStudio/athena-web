import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppEnv, CallerPrincipal } from '../../src/context';
import { clientDisplayName } from '../../src/lib/provenance/clients';
import {
  appProvenance,
  athenaProvenance,
  auditOrigin,
  currentProvenance,
  emailProvenance,
  integrationProvenance,
  MissingProvenanceError,
  originFor,
  ruleProvenance,
  runWithProvenance,
} from '../../src/lib/provenance/context';
import { provenanceMiddleware } from '../../src/lib/provenance/rest-middleware';
import type { McpContext } from '../../src/mcp/auth';
import { type McpRegistrar, ProvenanceRegistrar } from '../../src/mcp/catalog';
import { mcpProvenance } from '../../src/mcp/provenance';

const USER_PRINCIPAL = {
  kind: 'user',
  userId: 'user_1',
  userName: 'Ada',
  userEmail: 'ada@example.com',
} as const;

describe('originFor', () => {
  it('merges the scope, the writer detail, and the operation name', () => {
    const origin = runWithProvenance(athenaProvenance('chat', 'sess_1'), () =>
      originFor('capture', { planId: 'plan_1', ref: { commandId: 'cmd_1' } }),
    );

    expect(origin).toEqual({
      v: 2,
      channel: 'athena',
      surface: 'chat',
      performer: { kind: 'athena', name: 'Athena' },
      sessionId: 'sess_1',
      planId: 'plan_1',
      ref: { commandId: 'cmd_1' },
      tool: 'capture',
    });
  });

  it('merges a writer ref into the scope ref', () => {
    const origin = originFor(
      'materialize',
      { ref: { commandId: 'cmd_1' } },
      ruleProvenance('recurrence', { seriesId: 'series_1' }),
    );

    expect(origin.ref).toEqual({ seriesId: 'series_1', commandId: 'cmd_1' });
  });

  it('refuses to record outside any provenance scope', () => {
    expect(currentProvenance()).toBeNull();
    expect(() => originFor('patch')).toThrow(MissingProvenanceError);
  });

  it('leaves a best-effort activity row without an origin outside any scope', () => {
    expect(auditOrigin('patch')).toBeNull();
    expect(runWithProvenance(appProvenance('detail'), () => auditOrigin('patch'))).toMatchObject({
      channel: 'app',
      surface: 'detail',
      tool: 'patch',
    });
  });
});

describe('provenance bases', () => {
  it('names each non-app performer', () => {
    expect(appProvenance()).toEqual({ channel: 'app', performer: { kind: 'person' } });
    expect(integrationProvenance('import', { id: 'int_1', provider: 'notion' })).toEqual({
      channel: 'import',
      performer: { kind: 'docket', name: 'notion' },
      integration: { id: 'int_1', provider: 'notion' },
    });
    expect(emailProvenance('msg_1')).toMatchObject({
      channel: 'email',
      performer: { kind: 'athena' },
      ref: { messageId: 'msg_1' },
    });
    expect(emailProvenance()).not.toHaveProperty('ref');
    expect(ruleProvenance('cycle_roll')).not.toHaveProperty('ref');
  });
});

describe('clientDisplayName', () => {
  it('prefers the registered name, then a name derived from the client id', () => {
    expect(clientDisplayName('https://claude.ai/oauth', ' Claude ')).toBe('Claude');
    expect(clientDisplayName('https://claude.ai/oauth', undefined)).toBe('claude.ai');
    expect(clientDisplayName('client_1', null)).toBe('client_1');
  });

  it('treats a blank registered name as none', () => {
    expect(clientDisplayName('client_1', '  ')).toBe('client_1');
  });
});

describe('mcpProvenance', () => {
  it('names a registered agent by its actor', () => {
    const ctx: McpContext = {
      principal: {
        kind: 'agent',
        agentActorId: 'actor_agent',
        orgId: 'org_1',
        displayName: 'Release bot',
      },
      scopes: [],
    } as unknown as McpContext;

    expect(mcpProvenance(ctx, 'sess_1')).toEqual({
      channel: 'mcp',
      performer: { kind: 'agent', name: 'Release bot', actorId: 'actor_agent' },
      client: 'Release bot',
      sessionId: 'sess_1',
    });
  });

  it('names a bearer client by its registered name, never its own claim', () => {
    const unnamed: McpContext = { principal: USER_PRINCIPAL, scopes: [], clientId: 'client_2' };

    expect(mcpProvenance(unnamed, null, { name: 'Claude', version: null })).toMatchObject({
      performer: { kind: 'agent', name: 'client_2' },
      client: 'client_2',
    });
  });

  it('records a bearer client with its declared version', () => {
    const ctx: McpContext = {
      principal: USER_PRINCIPAL,
      scopes: [],
      clientId: 'client_1',
      clientName: 'Claude',
    };

    expect(mcpProvenance(ctx, null, { name: 'claude-ai', version: '0.9.1' })).toEqual({
      channel: 'mcp',
      performer: { kind: 'agent', name: 'Claude' },
      client: 'Claude',
      clientId: 'client_1',
      clientVersion: '0.9.1',
    });
  });

  it('records a caller with no client as the person', () => {
    expect(mcpProvenance({ principal: USER_PRINCIPAL, scopes: [] }, null)).toEqual({
      channel: 'mcp',
      performer: { kind: 'person' },
    });
  });
});

describe('ProvenanceRegistrar', () => {
  /** A registrar that records what reached it and invokes tool callbacks immediately. */
  function recordingRegistrar(): McpRegistrar & { readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      registerTool: ((name: string, _config: unknown, cb: () => unknown) => {
        calls.push(`tool:${name}:${JSON.stringify(cb())}`);
        return {};
      }) as unknown as McpRegistrar['registerTool'],
      registerResource: ((name: string) => {
        calls.push(`resource:${name}`);
        return {};
      }) as unknown as McpRegistrar['registerResource'],
      registerPrompt: ((name: string) => {
        calls.push(`prompt:${name}`);
        return {};
      }) as unknown as McpRegistrar['registerPrompt'],
    };
  }

  it('runs tools inside the caller provenance and passes resources and prompts through', () => {
    const inner = recordingRegistrar();
    const registrar = new ProvenanceRegistrar(inner, appProvenance('list'));

    registrar.registerTool('probe', {}, (() => currentProvenance()?.surface) as never);
    registrar.registerResource('notes', 'docket://notes', {}, () => ({ contents: [] }));
    registrar.registerPrompt('brief', {}, () => ({ messages: [] }));

    expect(inner.calls).toEqual(['tool:probe:"list"', 'resource:notes', 'prompt:brief']);
    expect(registrar.tasksEnabled).toBe(false);
  });
});

/** A router that answers with the provenance its request ran inside. */
function appWith(principal: CallerPrincipal | null): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('principal', principal);
    await next();
  });
  app.use('*', provenanceMiddleware);
  app.get('/', (c) => c.json({ base: currentProvenance() }));
  return app;
}

/** Read the provenance a request ran inside. */
async function baseFor(app: Hono<AppEnv>, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await app.request('/', { headers });
  const body = (await response.json()) as { base: unknown };
  return body.base;
}

describe('provenanceMiddleware', () => {
  const session = {
    kind: 'session',
    userId: 'user_1',
    user: {},
    session: {},
  } as unknown as CallerPrincipal;

  it('records a session as a person in the app, on the surface the app named', async () => {
    const app = appWith(session);

    expect(await baseFor(app, { 'Docket-Surface': 'detail' })).toEqual({
      channel: 'app',
      surface: 'detail',
      performer: { kind: 'person' },
    });
    expect(await baseFor(app, { 'Docket-Surface': 'phone' })).toEqual({
      channel: 'app',
      performer: { kind: 'person' },
    });
  });

  it('records an OAuth token as its client on the REST API', async () => {
    const app = appWith({
      kind: 'oauth',
      userId: 'user_1',
      user: {},
      clientId: 'https://cursor.com/oauth',
      clientName: null,
      scopes: [],
    } as unknown as CallerPrincipal);

    expect(await baseFor(app)).toEqual({
      channel: 'api',
      performer: { kind: 'agent', name: 'cursor.com' },
      client: 'cursor.com',
      clientId: 'https://cursor.com/oauth',
    });
  });

  it('declares nothing for an anonymous request', async () => {
    expect(await baseFor(appWith(null))).toBeNull();
  });
});
