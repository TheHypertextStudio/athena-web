/**
 * The `@docket/integrations` package entry point (`src/index.ts`).
 *
 * @remarks
 * The barrel is a plain `export *` list — its whole job is to keep every re-export line
 * wired to the right module, because apps/api and apps/web import dozens of runtime values
 * through it by name (e.g. `MockConnector`, `beginMcpOAuthAuthorization`,
 * `MAIL_CAPABLE_PROVIDERS`). Nothing else in the suite imports `src/index.ts` itself — every
 * other test reaches its module directly (`../src/connector-error`, `../src/mock-connector`,
 * ...) — so a dropped, typo'd, or shadowed `export *` line here would only surface as a
 * production import failure, not a test failure. This test imports the real barrel and checks
 * one representative runtime export per re-exported module, so that failure mode fails here
 * instead.
 */
import { describe, expect, it } from 'vitest';

import * as Integrations from '../src/index';

describe('@docket/integrations package entry point', () => {
  it('re-exports the connector port and its capability guards', () => {
    expect(typeof Integrations.isConnectorError).toBe('function');
    expect(typeof Integrations.ConnectorError).toBe('function');
    expect(Integrations.WRITE_BACK_CAPABLE_PROVIDERS).toBeInstanceOf(Set);
  });

  it('re-exports event, fixture, and JSON helpers', () => {
    expect(typeof Integrations.genericDetail).toBe('function');
    expect(Integrations.FIXED_NOW).toBe('2026-01-01T00:00:00.000Z');
    expect(typeof Integrations.asRecord).toBe('function');
  });

  it('re-exports the GitHub App and default HTTP client adapters', () => {
    expect(typeof Integrations.decodeAppPrivateKey).toBe('function');
    expect(typeof Integrations.defaultHttpClient).toBe('function');
  });

  it('re-exports the Lattice gateway, OAuth, and SDK surfaces', () => {
    expect(typeof Integrations.LatticeUnavailableError).toBe('function');
    expect(Array.isArray(Integrations.LATTICE_SCOPES)).toBe(true);
    expect(typeof Integrations.LatticeClient).toBe('function');
  });

  it('re-exports the Linear Agent, mail, and MCP OAuth/network surfaces', () => {
    expect(typeof Integrations.buildLinearAgentAuthorizeUrl).toBe('function');
    expect(Integrations.MAIL_CAPABLE_PROVIDERS).toBeInstanceOf(Set);
    expect(typeof Integrations.beginMcpOAuthAuthorization).toBe('function');
    expect(typeof Integrations.mcpSafeFetch).toBe('function');
  });

  it('re-exports the MCP Apps host, sandbox, and connector fixtures', () => {
    expect(typeof Integrations.createMcpAppHost).toBe('function');
    expect(typeof Integrations.withCspMeta).toBe('function');
    expect(Integrations.WIDGET_FIXTURE_URI).toBe('ui://acme-release/checklist');
  });

  it('re-exports the mock and real connector/observer/agent test doubles', () => {
    expect(typeof Integrations.MockConnector).toBe('function');
    expect(typeof Integrations.RealConnector).toBe('function');
    expect(typeof Integrations.MockLinearAgent).toBe('function');
    expect(typeof Integrations.MockObserver).toBe('function');
    expect(typeof Integrations.RealGitHubObserver).toBe('function');
    expect(typeof Integrations.RealLinearObserver).toBe('function');
    expect(typeof Integrations.slackMentionedUserIds).toBe('function');
  });

  it('re-exports the Notion mapping, provider-client guards, push, and SMS adapters', () => {
    expect(Integrations.NOTION_API_VERSION).toBe('2026-03-11');
    expect(typeof Integrations.isWritableProviderClient).toBe('function');
    expect(typeof Integrations.CapturePushSender).toBe('function');
    expect(typeof Integrations.CaptureSmsSender).toBe('function');
  });

  it('re-exports the Sunsama connector, fixtures, and field mapping', () => {
    expect(Integrations.SUNSAMA_MCP_URL).toBe('https://api.sunsama.com/mcp');
    expect(Integrations.SUNSAMA_PROVENANCE_PROVIDER).toBe('sunsama');
    expect(Integrations.SUNSAMA_FIXTURE_URL).toContain('sunsama.fixture');
    expect(Array.isArray(Integrations.DOCKET_WORKSPACE_NAMES)).toBe(true);
  });

  it('actually functions end-to-end through the barrel, not just by name', () => {
    // Exercises real re-exported implementations (not stand-ins) so the barrel is proven to
    // hand back working code, not merely present-but-broken bindings.
    const error = new Integrations.ConnectorError('token rejected', {
      provider: 'gmail',
      kind: 'auth',
    });
    expect(Integrations.isConnectorError(error)).toBe(true);
    expect(Integrations.isConnectorError(new Error('plain'))).toBe(false);
    expect(Integrations.asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(Integrations.asRecord('not an object')).toBeUndefined();
  });
});
