/**
 * Behavior tests for Athena model-backend selection.
 *
 * @remarks
 * Two properties matter more than the individual branches. The first is precedence: an operator
 * who supplies a Lattice endpoint must get it even when Docket's own router is configured, and
 * local/test mode must beat everything, because a developer with production keys in their shell
 * should still not spend them. The second is that the descriptor never carries a credential —
 * it is the object rendered on operator surfaces, so a key reaching it is a leak.
 *
 * `buildTurnRuntime` is injected throughout, which keeps these tests off the network and away
 * from SDK client construction while still exercising the lazy-build contract.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ATHENA_MODEL,
  MOCK_ATHENA_MODEL,
  MODEL_BACKEND_IDS,
  type ModelBackendEnv,
  ModelBackendConfigError,
  resolveModelBackend,
  selectModelBackendId,
} from '../src/turn/model-backend';
import type { AgentTurnRuntime } from '../src/turn/contracts';

const LATTICE: ModelBackendEnv = {
  APP_MODE: 'production',
  ATHENA_LATTICE_BASE_URL: 'https://lattice.example',
  ATHENA_LATTICE_API_KEY: 'lattice-key',
};

const ROUTER: ModelBackendEnv = {
  APP_MODE: 'production',
  CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://gateway.example',
  CLOUDFLARE_AI_GATEWAY_TOKEN: 'gateway-token',
  ANTHROPIC_API_KEY: 'anthropic-key',
};

const DIRECT: ModelBackendEnv = { APP_MODE: 'production', ANTHROPIC_API_KEY: 'anthropic-key' };

/** A runtime stand-in, so no test constructs a real SDK client. */
const stubRuntime = (): AgentTurnRuntime => ({}) as AgentTurnRuntime;

describe('selectModelBackendId', () => {
  it('sends local and test modes to the scripted backend regardless of credentials', () => {
    for (const mode of ['local', 'test'] as const) {
      // Every live credential is present and must still lose to the mode.
      expect(selectModelBackendId({ ...LATTICE, ...ROUTER, APP_MODE: mode })).toBe('mock');
    }
  });

  it('prefers an operator Lattice endpoint over Docket’s own router', () => {
    expect(selectModelBackendId({ ...ROUTER, ...LATTICE })).toBe('lattice');
  });

  it('prefers the router over direct provider access', () => {
    expect(selectModelBackendId(ROUTER)).toBe('cloudflare-router');
  });

  it('falls back to direct provider access when nothing else is configured', () => {
    expect(selectModelBackendId(DIRECT)).toBe('anthropic-direct');
    expect(selectModelBackendId({})).toBe('anthropic-direct');
  });

  it('treats a half-configured tier as not configured', () => {
    // A base URL with no key is a misconfiguration, not a selection — falling through is what
    // stops a turn from being attempted against an endpoint it cannot authenticate to.
    expect(selectModelBackendId({ ...DIRECT, ATHENA_LATTICE_BASE_URL: 'https://l.example' })).toBe(
      'anthropic-direct',
    );
    expect(selectModelBackendId({ ...DIRECT, ATHENA_LATTICE_API_KEY: 'k' })).toBe(
      'anthropic-direct',
    );
    expect(
      selectModelBackendId({ ...DIRECT, CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://g.example' }),
    ).toBe('anthropic-direct');
  });

  it('treats a blank or whitespace-only value as absent', () => {
    expect(
      selectModelBackendId({
        ...DIRECT,
        ATHENA_LATTICE_BASE_URL: '   ',
        ATHENA_LATTICE_API_KEY: '',
      }),
    ).toBe('anthropic-direct');
  });
});

describe('resolveModelBackend', () => {
  it('describes the scripted backend without any credential or endpoint', () => {
    const { descriptor } = resolveModelBackend({ APP_MODE: 'test' });
    expect(descriptor).toEqual({
      id: 'mock',
      label: 'Local scripted model',
      routed: false,
      userSupplied: false,
      baseURL: null,
      model: MOCK_ATHENA_MODEL,
    });
  });

  it('marks a Lattice backend operator-supplied and unrouted', () => {
    const { descriptor } = resolveModelBackend(LATTICE, { buildTurnRuntime: stubRuntime });
    expect(descriptor).toEqual({
      id: 'lattice',
      label: 'Your Lovelace Lattice instance',
      routed: false,
      userSupplied: true,
      baseURL: 'https://lattice.example',
      model: DEFAULT_ATHENA_MODEL,
    });
  });

  it('marks the Cloudflare tier routed and Docket-supplied', () => {
    const { descriptor } = resolveModelBackend(ROUTER, { buildTurnRuntime: stubRuntime });
    expect(descriptor).toMatchObject({
      id: 'cloudflare-router',
      routed: true,
      userSupplied: false,
      baseURL: 'https://gateway.example',
    });
  });

  it('gives direct provider access no endpoint of its own', () => {
    const { descriptor } = resolveModelBackend(DIRECT, { buildTurnRuntime: stubRuntime });
    expect(descriptor).toMatchObject({ id: 'anthropic-direct', routed: false, baseURL: null });
  });

  it('honors a model override on every live tier but not on the scripted one', () => {
    for (const env of [LATTICE, ROUTER, DIRECT]) {
      const { descriptor } = resolveModelBackend(
        { ...env, ATHENA_MODEL: 'claude-custom' },
        { buildTurnRuntime: stubRuntime },
      );
      expect(descriptor.model).toBe('claude-custom');
    }
    const mock = resolveModelBackend({ APP_MODE: 'test', ATHENA_MODEL: 'claude-custom' });
    expect(mock.descriptor.model).toBe(MOCK_ATHENA_MODEL);
  });

  it('ignores a blank model override and uses the default', () => {
    const { descriptor } = resolveModelBackend(
      { ...DIRECT, ATHENA_MODEL: '  ' },
      { buildTurnRuntime: stubRuntime },
    );
    expect(descriptor.model).toBe(DEFAULT_ATHENA_MODEL);
  });

  it('keeps every credential out of the descriptor', () => {
    for (const env of [LATTICE, ROUTER, DIRECT]) {
      const { descriptor } = resolveModelBackend(env, { buildTurnRuntime: stubRuntime });
      const rendered = JSON.stringify(descriptor);
      for (const secret of ['lattice-key', 'gateway-token', 'anthropic-key']) {
        expect(rendered).not.toContain(secret);
      }
    }
  });

  it('names every missing key when a forced tier is unconfigured', () => {
    try {
      resolveModelBackend({ APP_MODE: 'production' }, { force: 'cloudflare-router' });
      throw new Error('expected a config error');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelBackendConfigError);
      const config = error as ModelBackendConfigError;
      expect(config.backendId).toBe('cloudflare-router');
      // All three at once, so an operator fixes the config in one pass rather than three.
      expect(config.message).toContain('CLOUDFLARE_AI_GATEWAY_BASE_URL');
      expect(config.message).toContain('CLOUDFLARE_AI_GATEWAY_TOKEN');
      expect(config.message).toContain('ANTHROPIC_API_KEY');
    }
  });

  it('refuses a forced Lattice or direct tier that is missing its own config', () => {
    expect(() => resolveModelBackend({}, { force: 'lattice' })).toThrow(ModelBackendConfigError);
    expect(() => resolveModelBackend({}, { force: 'anthropic-direct' })).toThrow(
      ModelBackendConfigError,
    );
    // The router tier still needs the provider key behind it.
    expect(() =>
      resolveModelBackend(
        {
          CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://g.example',
          CLOUDFLARE_AI_GATEWAY_TOKEN: 't',
        },
        { force: 'cloudflare-router' },
      ),
    ).toThrow(ModelBackendConfigError);
  });

  it('forces a tier over what the environment would have selected', () => {
    const forced = resolveModelBackend({ ...LATTICE, ...ROUTER }, { force: 'anthropic-direct' });
    expect(forced.descriptor.id).toBe('anthropic-direct');
  });

  it('builds the runtime lazily, once, and hands it the tier’s own credential', () => {
    const build = vi.fn(stubRuntime);
    const backend = resolveModelBackend(LATTICE, { buildTurnRuntime: build });
    // Resolving describes the tier; it must not construct a client.
    expect(build).not.toHaveBeenCalled();

    const first = backend.turnRuntime();
    const second = backend.turnRuntime();
    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(build).toHaveBeenCalledWith(backend.descriptor, 'lattice-key');
  });

  it('passes the provider key for the two Docket-owned tiers and none for the scripted one', () => {
    const credentials: string[] = [];
    const capture = (_d: unknown, credential: string): AgentTurnRuntime => {
      credentials.push(credential);
      return stubRuntime();
    };
    for (const env of [ROUTER, DIRECT]) {
      resolveModelBackend(env, { buildTurnRuntime: capture }).turnRuntime();
    }
    resolveModelBackend({ APP_MODE: 'test' }, { buildTurnRuntime: capture }).turnRuntime();
    expect(credentials).toEqual(['anthropic-key', 'anthropic-key', '']);
  });

  it('lists its tiers in preference order', () => {
    expect(MODEL_BACKEND_IDS).toEqual(['lattice', 'cloudflare-router', 'anthropic-direct', 'mock']);
    // The declared order is the order selection actually applies.
    const envs: ModelBackendEnv[] = [{ ...LATTICE, ...ROUTER }, ROUTER, DIRECT];
    expect(envs.map(selectModelBackendId)).toEqual(MODEL_BACKEND_IDS.slice(0, 3));
  });

  it('builds a real runtime when no builder is injected', () => {
    // The scripted tier is the one live path that constructs nothing network-bound, so it is the
    // one this can exercise without reaching for a provider client.
    const backend = resolveModelBackend({ APP_MODE: 'local' });
    expect(backend.turnRuntime()).toBe(backend.turnRuntime());
  });
});
