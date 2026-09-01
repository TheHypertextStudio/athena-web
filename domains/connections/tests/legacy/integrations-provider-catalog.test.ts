import { describe, expect, test } from 'vitest';

import {
  CONNECTOR_PROVIDER_IDS,
  DIRECTORY_PROVIDER_IDS,
  WEBHOOK_PROVIDER_IDS,
  connectorIdentityProvider,
  providerSourceSystem,
  sourceIdentityProvider,
} from '../../src/contracts/provider-catalog';

describe('provider catalog', () => {
  test('separates connector, directory, and webhook provider ids', () => {
    expect(CONNECTOR_PROVIDER_IDS).toEqual([
      'gmail',
      'gtasks',
      'calendar',
      'drive',
      'github',
      'linear',
      'notion',
    ]);
    expect(DIRECTORY_PROVIDER_IDS).toEqual([...CONNECTOR_PROVIDER_IDS]);
    expect(WEBHOOK_PROVIDER_IDS).toEqual(['github', 'linear', 'notion']);
  });

  test('lets a provider observe webhooks without emitting activity events', () => {
    // Notion is the case that separates the two ideas. Its webhooks wake the mirror's pull-back,
    // so it needs an inbound edge — but it contributes nothing to the activity feed, so it has no
    // `source_system`. Coupling the two would force a migration adding an enum value that only
    // ever produces drafts nothing renders.
    expect(WEBHOOK_PROVIDER_IDS).toContain('notion');
    expect(providerSourceSystem('notion')).toBeNull();
  });

  test('maps providers to their canonical event source systems', () => {
    expect(providerSourceSystem('github')).toBe('github');
    expect(providerSourceSystem('linear')).toBe('linear');
    expect(providerSourceSystem('gmail')).toBe('gmail');
    expect(providerSourceSystem('calendar')).toBe('google_calendar');
    expect(providerSourceSystem('gtasks')).toBeNull();
    expect(providerSourceSystem('drive')).toBe('google_drive');
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

  test('has no linked identity provider for a source system no directory provider emits', () => {
    // `docket` (internal), `slack`, `discord`, and `outlook` are valid SourceSystemKind values,
    // but no entry in the catalog claims them as its `sourceSystem` — there is nothing to resolve
    // participants through.
    expect(sourceIdentityProvider('docket')).toBeNull();
    expect(sourceIdentityProvider('slack')).toBeNull();
  });
});
