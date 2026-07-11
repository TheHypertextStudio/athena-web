/**
 * Validate and normalize the API origin baked into the Next.js reverse-proxy rewrites.
 *
 * @remarks
 * A production deployment that points `API_URL` at the browser-facing app recursively rewrites
 * `/api/auth/*` and `/v1/*` back into itself. Vercel eventually terminates that recursion with
 * `508 INFINITE_LOOP_DETECTED`. Failing the build makes the configuration mistake impossible to
 * promote.
 *
 * @param apiUrl - The configured API origin.
 * @param appUrl - The browser-facing application origin, when configured.
 * @returns The normalized API origin without a trailing slash.
 * @throws When either URL is invalid, uses a non-HTTP protocol, or resolves to the same origin.
 */
export function validatedApiOrigin(apiUrl: string, appUrl?: string): string {
  let api: URL;
  try {
    api = new URL(apiUrl);
  } catch {
    throw new Error(`API_URL must be an absolute URL, received ${JSON.stringify(apiUrl)}`);
  }
  if (api.protocol !== 'http:' && api.protocol !== 'https:') {
    throw new Error(`API_URL must use http or https, received ${api.protocol}`);
  }
  if (appUrl) {
    let app: URL;
    try {
      app = new URL(appUrl);
    } catch {
      throw new Error(
        `NEXT_PUBLIC_APP_URL must be an absolute URL, received ${JSON.stringify(appUrl)}`,
      );
    }
    if (api.origin === app.origin) {
      throw new Error('API_URL and NEXT_PUBLIC_APP_URL must use different origins');
    }
  }
  return api.origin;
}
