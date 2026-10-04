import { describe, expect, it } from 'vitest';

import {
  acceptanceTargets,
  credentialTiming,
  requestLogMetadata,
  runtimeSecretBindings,
  servingRevision,
} from '../../scripts/lattice-acceptance-report';

describe('bounded Lattice acceptance reporting', () => {
  it('reads the pinned serving revision and refuses an ambiguous traffic split', () => {
    expect(
      servingRevision({
        status: {
          latestReadyRevisionName: 'new-ready',
          latestCreatedRevisionName: 'new-failed',
          traffic: [
            { revisionName: 'old-serving', percent: 100 },
            { revisionName: 'new-ready', percent: 0 },
          ],
        },
      }),
    ).toBe('old-serving');
    expect(() =>
      servingRevision({
        status: {
          traffic: [
            { revisionName: 'first', percent: 50 },
            { revisionName: 'second', percent: 50 },
          ],
        },
      }),
    ).toThrow('Ambiguous serving revisions');
    expect(() => servingRevision({ status: {} })).toThrow('Serving revision unavailable');
  });
  it('keeps request correlation while removing query credentials, headers, and provider bodies', () => {
    const result = requestLogMetadata([
      {
        timestamp: '2026-09-30T02:38:14Z',
        insertId: 'record-id',
        trace: 'trace-id',
        httpRequest: {
          requestUrl: 'https://api.example.test/v1/me/athena/chat/messages?token=SECRET',
          status: 503,
          requestMethod: 'POST',
          latency: '8.53s',
          authorization: 'SECRET',
        },
        jsonPayload: { accessToken: 'SECRET' },
      },
    ]);
    expect(result[0]).toMatchObject({
      path: '/v1/me/athena/chat/messages',
      status: 503,
      trace: 'trace-id',
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|authorization|accessToken/);
    expect(
      requestLogMetadata([{ httpRequest: { requestUrl: 'malformed' } }])[0]?.['path'],
    ).toBeNull();
  });
  it('limits each environment to its recorded canaries and refuses another environment', () => {
    expect(acceptanceTargets('production')).toEqual({
      assignmentIds: ['01M41GY6TZ6Z6AF87E2RS56PRB', '01M41KQSTHHXHKV61ZT4DXRW8K'],
      workIds: [],
    });
    expect(acceptanceTargets('staging').workIds).toEqual([
      'work_01M3RAGV53DR0BBBBQ1BZKCBBZ',
      'work_01M3RESNA78DAVDT7THMJY61CF',
    ]);
    expect(() => acceptanceTargets('production; arbitrary-command')).toThrow(
      'Unknown audit target',
    );
  });

  it('reports grant timing and identity while excluding both tokens and unknown fields', () => {
    const claims = Buffer.from(JSON.stringify({ sub: 'proof-subject', exp: 1791055303 })).toString(
      'base64url',
    );
    const input = {
      kind: 'lattice_oauth',
      accessToken: `header.${claims}.SECRET-ACCESS-CANARY`,
      refreshToken: 'SECRET-REFRESH-CANARY',
      obtainedAt: '2026-10-03T19:21:43.447Z',
      expiresInSeconds: 3600,
      scope: 'lattice:personal:read offline_access',
      clientId: 'https://clearthedocket.com/.well-known/lattice-client.json',
      ciphertext: 'SECRET-CIPHERTEXT-CANARY',
    };
    const result = credentialTiming(input);
    expect(result).toEqual({
      clientId: input.clientId,
      obtainedAt: input.obtainedAt,
      expiresInSeconds: 3600,
      expiresAt: '2026-10-03T20:21:43.447Z',
      scope: input.scope,
      refreshAvailable: true,
      subject: 'proof-subject',
      tokenExpiresAt: new Date(1791055303 * 1000).toISOString(),
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET-|accessToken|refreshToken|ciphertext/);
  });

  it('does not invent token identity or expiry for opaque, malformed, or unbounded tokens', () => {
    const result = credentialTiming({
      kind: 'lattice_oauth',
      accessToken: 'opaque-token',
      refreshToken: null,
      obtainedAt: 'not-a-date',
      expiresInSeconds: null,
      scope: null,
    });
    expect(result).toMatchObject({
      expiresAt: null,
      tokenExpiresAt: null,
      subject: null,
      refreshAvailable: false,
    });
    expect(() => credentialTiming({ kind: 'pending', accessToken: 'SECRET' })).toThrow(
      'No approved OAuth credential',
    );
  });

  it('resolves runtime secret references without copying literal environment values', () => {
    const result = runtimeSecretBindings({
      status: { latestReadyRevisionName: 'docket-api-verified', url: 'https://api.example.test' },
      spec: {
        template: {
          spec: {
            containers: [
              {
                env: [
                  { name: 'RESEND_API_KEY', value: 'SECRET-MAIL-CANARY' },
                  {
                    name: 'DATABASE_URL',
                    valueFrom: { secretKeyRef: { name: 'docket-db', key: '5' } },
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(result).toEqual({
      revision: 'docket-api-verified',
      url: 'https://api.example.test',
      bindings: [{ environmentName: 'DATABASE_URL', secretName: 'docket-db', version: '5' }],
    });
    expect(JSON.stringify(result)).not.toContain('SECRET-MAIL-CANARY');
  });
});
