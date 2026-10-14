/** Adapt the auth library's token-endpoint throttle response to the OAuth wire format. */
export function withOAuthRateLimitResponse(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await handler(request);
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (path !== '/api/auth/oauth2/token' || response.status !== 429) return response;

    // Better Auth's limiter runs before OAuth endpoints and returns { message }, which OAuth
    // clients cannot decode. Preserve the rejection and its delay without invalidating a grant.
    const headers = new Headers(response.headers);
    const retryAfter = headers.get('Retry-After') ?? headers.get('X-Retry-After');
    if (retryAfter !== null) headers.set('Retry-After', retryAfter);
    headers.delete('Content-Length');
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    headers.set('Pragma', 'no-cache');
    return new Response(
      JSON.stringify({
        error: 'temporarily_unavailable',
        error_description: 'Too many token requests. Retry after the indicated delay.',
      }),
      { status: response.status, statusText: response.statusText, headers },
    );
  };
}
