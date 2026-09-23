import type { LatticeDevice } from '@docket/integrations';

/** A personal runtime as the gateway reports it in route tests. */
export function latticeDevice(overrides: Partial<LatticeDevice> = {}): LatticeDevice {
  return {
    id: 'lat_studio',
    name: 'Studio Mac',
    status: 'reachable',
    ready: true,
    lastSeenAt: '2026-08-29T12:00:00.000Z',
    executionBackend: 'local-model',
    ...overrides,
  };
}
