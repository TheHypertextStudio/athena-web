import { describe, expect, it } from 'vitest';
import { releaseIdentityResponse } from '../../release-identity';

describe('Worker release identity', () => {
  it.each([undefined, '', '   ', 42])('rejects an incomplete marker %s', async (value) => {
    const response = releaseIdentityResponse({
      STUDIO_SOURCE_SHA: 'source',
      STUDIO_ARTIFACT_SHA256: value,
      STUDIO_CANDIDATE_ID: 'candidate',
      UNRELATED_SECRET: 'must-not-appear',
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });

  it('reports exactly the three complete release markers', async () => {
    const response = releaseIdentityResponse({
      STUDIO_SOURCE_SHA: 'source',
      STUDIO_ARTIFACT_SHA256: 'artifact',
      STUDIO_CANDIDATE_ID: 'candidate',
      UNRELATED_SECRET: 'must-not-appear',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      sourceSha: 'source',
      artifactSha256: 'artifact',
      candidateId: 'candidate',
    });
  });
});
