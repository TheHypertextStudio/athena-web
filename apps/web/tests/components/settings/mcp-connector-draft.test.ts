import { describe, expect, it } from 'vitest';

import {
  connectorReadinessLabel,
  deriveMcpConnectorDraft,
} from '@/components/settings/mcp-connector-draft';

describe('deriveMcpConnectorDraft', () => {
  it('uses the provider host for a clean default name and alias', () => {
    expect(deriveMcpConnectorDraft('https://api.sunsama.com/mcp')).toEqual({
      label: 'Sunsama',
      alias: 'sunsama',
    });
  });

  it('does not replace a user-authored name or alias', () => {
    expect(
      deriveMcpConnectorDraft('https://mcp.acme-tools.example/connect', {
        label: 'Planning',
        alias: 'planning',
      }),
    ).toEqual({ label: 'Planning', alias: 'planning' });
  });
});

describe('connectorReadinessLabel', () => {
  it('uses product language instead of transport status', () => {
    expect(connectorReadinessLabel('connected')).toBe('Ready for Athena');
    expect(connectorReadinessLabel('pending')).toBe('Approval required');
    expect(connectorReadinessLabel('error')).toBe('Needs attention');
    expect(connectorReadinessLabel('disconnected')).toBe('Disconnected');
  });
});
