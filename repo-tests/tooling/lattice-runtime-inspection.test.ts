import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundSecret, gcloud } from '../../scripts/lattice-runtime-inspection';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '  sentinel-value\n') }));
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runtime secret byte preservation', () => {
  it('preserves stored secret whitespace rather than changing a signing credential', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    expect(
      boundSecret(
        {
          revision: null,
          url: null,
          bindings: [
            { environmentName: 'BETTER_AUTH_SECRET', secretName: 'stage-auth', version: '5' },
          ],
        },
        'BETTER_AUTH_SECRET',
      ),
    ).toBe('  sentinel-value\n');
    expect(gcloud(['run', 'services', 'describe', 'example'])).toBe('sentinel-value');
  });
});
