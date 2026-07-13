import { describe, expect, test } from 'vitest';

import {
  CONNECTOR_PROVIDER_IDS,
  DIRECTORY_PROVIDER_IDS,
  WEBHOOK_PROVIDER_IDS,
  connectorIdentityProvider,
  providerSourceSystem,
  sourceIdentityProvider,
} from '../src/provider-catalog';

describe('provider catalog', () => {
  test('separates connector, directory, and webhook provider ids', () => {
    expect(CONNECTOR_PROVIDER_IDS).toEqual(['gmail', 'gtasks', 'calendar', 'github', 'linear']);
    expect(DIRECTORY_PROVIDER_IDS).toEqual([...CONNECTOR_PROVIDER_IDS]);
    expect(WEBHOOK_PROVIDER_IDS).toEqual(['github', 'linear']);
  });

  test('maps providers to their canonical event source systems', () => {
    expect(providerSourceSystem('github')).toBe('github');
    expect(providerSourceSystem('linear')).toBe('linear');
    expect(providerSourceSystem('gmail')).toBe('gmail');
    expect(providerSourceSystem('calendar')).toBe('google_calendar');
    expect(providerSourceSystem('gtasks')).toBeNull();
  });

  test('maps connector and source ids to their linked identity providers', () => {
    expect(connectorIdentityProvider('github')).toBe('github');
    expect(connectorIdentityProvider('linear')).toBe('linear');
    expect(connectorIdentityProvider('calendar')).toBe('google');
    expect(sourceIdentityProvider('github')).toBe('github');
    expect(sourceIdentityProvider('linear')).toBe('linear');
    expect(sourceIdentityProvider('gmail')).toBe('google');
    expect(sourceIdentityProvider('google_calendar')).toBe('google');
  });
});
