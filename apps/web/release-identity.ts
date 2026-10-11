/** Report only complete shared release identity; unmarked artifacts are not accepted releases. */
export function releaseIdentityResponse(env: Record<string, unknown>): Response {
  const identity = {
    sourceSha: env['STUDIO_SOURCE_SHA'],
    artifactSha256: env['STUDIO_ARTIFACT_SHA256'],
    candidateId: env['STUDIO_CANDIDATE_ID'],
  };
  const complete = Object.values(identity).every(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  return Response.json(complete ? identity : { status: 'unavailable' }, {
    status: complete ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
