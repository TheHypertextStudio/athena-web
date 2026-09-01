/**
 * Reject screenshot sessions that point outside the local development stack.
 *
 * @param baseUrl - The origin stored beside the authenticated development session.
 * @throws When the URL is invalid or its host is not local.
 */
export function assertLocalCaptureBaseUrl(baseUrl: string): void {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('capture-shots refuses invalid session metadata');
  }

  const localHost =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]';
  if (!localHost) {
    throw new Error(
      `capture-shots refuses non-local session metadata (${hostname}); fixture data must never be created in production`,
    );
  }
}
