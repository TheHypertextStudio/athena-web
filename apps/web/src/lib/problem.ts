import type { Problem } from '@docket/types';

/**
 * The full parse of a failed API response — the human message PLUS the machine-readable
 * `status`/`code` a caller needs to distinguish ONE specific failure from any other on the same
 * endpoint (e.g. a 409 write-scope conflict vs an unrelated 422 validation error), which the
 * message string alone cannot do.
 */
export interface ProblemDetails {
  /** The best available human-readable message (`detail` ?? `title` ?? the caller's fallback). */
  readonly message: string;
  /** The response's HTTP status code. */
  readonly status: number;
  /** The closed problem code, when the body parsed as a {@link Problem}. */
  readonly code?: Problem['code'];
}

/**
 * Parse a failed API response into its {@link ProblemDetails}.
 *
 * @remarks
 * Every API error is emitted as `application/problem+json` shaped like
 * {@link import('@docket/types').Problem | Problem}. This best-effort parses that body and
 * returns its `detail` (or `title`), status, and `code`; when the body is not a problem object
 * (network error, non-JSON) only `message` (the fallback) and `status` are available.
 * {@link readProblem} is a thin wrapper over this for the many call sites that only need the
 * display string.
 *
 * @param response - The non-OK `fetch`/RPC {@link Response}.
 * @param fallback - The message to use when no problem detail can be read.
 */
export async function readProblemDetails(
  response: Response,
  fallback: string,
): Promise<ProblemDetails> {
  try {
    const body = (await response.json()) as Partial<Problem>;
    return {
      message: body.detail ?? body.title ?? fallback,
      status: response.status,
      code: body.code,
    };
  } catch {
    return { message: fallback, status: response.status };
  }
}

/**
 * Read a human-readable message out of a failed API response.
 *
 * @remarks
 * A thin wrapper over {@link readProblemDetails} for the many call sites that only display the
 * message and don't need to branch on `status`/`code`.
 *
 * @param response - The non-OK `fetch`/RPC {@link Response}.
 * @param fallback - The message to use when no problem detail can be read.
 * @returns the best available human-readable error message.
 */
export async function readProblem(response: Response, fallback: string): Promise<string> {
  return (await readProblemDetails(response, fallback)).message;
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
