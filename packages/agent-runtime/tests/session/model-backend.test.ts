import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ATHENA_MODEL,
  MOCK_ATHENA_MODEL,
  MODEL_BACKEND_IDS,
  MockAgentTurnRuntime,
  ModelBackendConfigError,
  resolveModelBackend,
  selectModelBackendId,
  type ModelBackendEnv,
} from '../../src/index';

/** Production env with Docket's own routed access configured. */
const ROUTED: ModelBackendEnv = {
  APP_MODE: 'production',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://gateway.example/v1/acct/docket/anthropic',
  CLOUDFLARE_AI_GATEWAY_TOKEN: 'cf-token',
};

describe('selectModelBackendId', () => {
  it('defaults production to Cloudflare’s model router with Docket’s own key', () => {
    expect(selectModelBackendId(ROUTED)).toBe('cloudflare-router');
  });

  it('prefers an operator’s own Lattice instance over Docket’s routed access', () => {
    expect(
      selectModelBackendId({
        ...ROUTED,
        ATHENA_LATTICE_BASE_URL: 'https://lattice.internal/v1',
        ATHENA_LATTICE_API_KEY: 'lattice-key',
      }),
    ).toBe('lattice');
  });

  it('falls back to direct provider access when the router is not configured', () => {
    expect(selectModelBackendId({ APP_MODE: 'production', ANTHROPIC_API_KEY: 'sk-ant-test' })).toBe(
      'anthropic-direct',
    );
  });

  it('ignores a half-configured router rather than selecting a tier that cannot work', () => {
    expect(
      selectModelBackendId({
        APP_MODE: 'production',
        ANTHROPIC_API_KEY: 'sk-ant-test',
        CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://gateway.example',
      }),
    ).toBe('anthropic-direct');
    expect(
      selectModelBackendId({
        ...ROUTED,
        ATHENA_LATTICE_BASE_URL: '   ',
        ATHENA_LATTICE_API_KEY: 'lattice-key',
      }),
    ).toBe('cloudflare-router');
  });

  it('always selects the deterministic backend in local and test mode', () => {
    expect(selectModelBackendId({ ...ROUTED, APP_MODE: 'local' })).toBe('mock');
    expect(selectModelBackendId({ ...ROUTED, APP_MODE: 'test' })).toBe('mock');
  });
});

describe('resolveModelBackend', () => {
  it('describes the routed default without leaking a credential into the descriptor', () => {
    const backend = resolveModelBackend(ROUTED, {
      buildTurnRuntime: () => new MockAgentTurnRuntime(),
    });
    expect(backend.descriptor).toEqual({
      id: 'cloudflare-router',
      label: 'Docket model router',
      routed: true,
      userSupplied: false,
      baseURL: 'https://gateway.example/v1/acct/docket/anthropic',
      model: DEFAULT_ATHENA_MODEL,
    });
    expect(JSON.stringify(backend.descriptor)).not.toContain('cf-token');
    expect(JSON.stringify(backend.descriptor)).not.toContain('sk-ant-test');
  });

  it('marks an operator’s Lattice instance as user-supplied and hands it that credential', () => {
    const seen: string[] = [];
    const backend = resolveModelBackend(
      {
        APP_MODE: 'production',
        ANTHROPIC_API_KEY: 'sk-ant-docket',
        ATHENA_LATTICE_BASE_URL: 'https://lattice.internal/v1',
        ATHENA_LATTICE_API_KEY: 'lattice-key',
      },
      {
        buildTurnRuntime: (_descriptor, credential) => {
          seen.push(credential);
          return new MockAgentTurnRuntime();
        },
      },
    );
    expect(backend.descriptor.userSupplied).toBe(true);
    expect(backend.descriptor.routed).toBe(false);
    expect(backend.descriptor.baseURL).toBe('https://lattice.internal/v1');
    backend.turnRuntime();
    expect(seen).toEqual(['lattice-key']);
  });

  it('applies a model override to whichever tier is selected', () => {
    expect(
      resolveModelBackend(
        { ...ROUTED, ATHENA_MODEL: 'claude-sonnet-4-8' },
        { buildTurnRuntime: () => new MockAgentTurnRuntime() },
      ).descriptor.model,
    ).toBe('claude-sonnet-4-8');
  });

  it('builds the turn runtime lazily and only once', () => {
    const build = vi.fn(() => new MockAgentTurnRuntime());
    const backend = resolveModelBackend(ROUTED, { buildTurnRuntime: build });
    expect(build).not.toHaveBeenCalled();
    expect(backend.turnRuntime()).toBe(backend.turnRuntime());
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('returns the deterministic scripted runtime in local mode with no credential at all', async () => {
    const backend = resolveModelBackend({ APP_MODE: 'local' });
    expect(backend.descriptor.id).toBe('mock');
    expect(backend.descriptor.model).toBe(MOCK_ATHENA_MODEL);
    const events = [];
    for await (const event of backend
      .turnRuntime()
      .streamTurn({ system: '', messages: [], tools: [] })) {
      events.push(event.type);
    }
    expect(events.at(-1)).toBe('turn_end');
  });

  it('names every missing variable when a forced tier cannot be configured', () => {
    expect(() =>
      resolveModelBackend({ APP_MODE: 'production' }, { force: 'cloudflare-router' }),
    ).toThrow(ModelBackendConfigError);
    try {
      resolveModelBackend({ APP_MODE: 'production' }, { force: 'cloudflare-router' });
    } catch (caught) {
      expect((caught as Error).message).toContain('CLOUDFLARE_AI_GATEWAY_BASE_URL');
      expect((caught as Error).message).toContain('CLOUDFLARE_AI_GATEWAY_TOKEN');
      expect((caught as Error).message).toContain('ANTHROPIC_API_KEY');
      expect((caught as ModelBackendConfigError).backendId).toBe('cloudflare-router');
    }
    expect(() =>
      resolveModelBackend({ APP_MODE: 'production' }, { force: 'anthropic-direct' }),
    ).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => resolveModelBackend({ APP_MODE: 'production' }, { force: 'lattice' })).toThrow(
      /ATHENA_LATTICE_BASE_URL/,
    );
  });

  it('exposes every tier so a surface can enumerate them', () => {
    expect([...MODEL_BACKEND_IDS].sort()).toEqual([
      'anthropic-direct',
      'cloudflare-router',
      'lattice',
      'mock',
    ]);
  });
});
