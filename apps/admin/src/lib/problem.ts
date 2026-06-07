import type { Problem } from '@docket/types';

/**
 * Read a human-readable message out of a failed API response.
 *
 * @remarks
 * Every API error is emitted as `application/problem+json` shaped like
 * {@link import('@docket/types').Problem | Problem}. This best-effort parses that body and
 * returns its `detail` (or `title`) so screens can surface the server's own message; when
 * the body is not a problem object (network error, non-JSON) it returns `fallback`. The
 * common admin case is a 403 when the signed-in user is not staff.
 *
 * @param response - The non-OK `fetch`/RPC {@link Response}.
 * @param fallback - The message to use when no problem detail can be read.
 * @returns the best available human-readable error message.
 */
export async function readProblem(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as Partial<Problem>;
    return body.detail ?? body.title ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read a human-readable message off an arbitrary thrown value.
 *
 * @remarks
 * Used in `catch` blocks where the rejection may be an `Error` (e.g. a network failure
 * from the RPC client) or an opaque value.
 *
 * @param error - The caught value.
 * @param fallback - The message to use when nothing readable can be extracted.
 * @returns the error's `message` when it is an `Error`, otherwise `fallback`.
 */
export function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
