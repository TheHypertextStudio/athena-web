import { beforeAll, describe, expect, it } from 'vitest';

import type * as GithubApp from '../../src/lib/github-app';

let signInstallState!: typeof GithubApp.signInstallState;
let verifyInstallState!: typeof GithubApp.verifyInstallState;

beforeAll(async () => {
  ({ signInstallState, verifyInstallState } = await import('../../src/lib/github-app'));
});

const STATE = { integrationId: 'intg_1', orgId: 'org_1' };
const NOW = 1_750_000_000_000;

describe('install state sign/verify', () => {
  it('round-trips a valid, unexpired state', () => {
    const token = signInstallState(STATE, NOW);
    expect(verifyInstallState(token, NOW + 1000)).toEqual(STATE);
  });

  it('rejects an expired state', () => {
    const token = signInstallState(STATE, NOW);
    // Past the 10-minute TTL.
    expect(verifyInstallState(token, NOW + 11 * 60_000)).toBeNull();
  });

  it('rejects a tampered payload (re-binding to another org)', () => {
    const token = signInstallState(STATE, NOW);
    const sig = token.split('.')[1];
    const forgedPayload = Buffer.from(
      JSON.stringify({ integrationId: 'x', orgId: 'evil', exp: NOW + 60_000 }),
    ).toString('base64url');
    expect(verifyInstallState(`${forgedPayload}.${sig}`, NOW + 1000)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyInstallState('garbage', NOW)).toBeNull();
    expect(verifyInstallState('', NOW)).toBeNull();
  });
});
