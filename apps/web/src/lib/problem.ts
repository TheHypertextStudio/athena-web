import { Problem, type ProblemCode } from '@docket/types';

/** A failure whose message is application-owned and safe to render. */
export class UserFacingError extends Error {
  /** HTTP status when the failure came from an API response. */
  readonly status?: number;
  /** Stable API problem code when the response contained a valid Problem body. */
  readonly code?: ProblemCode;

  constructor(
    message: string,
    details: { status?: number; code?: ProblemCode; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'UserFacingError';
    this.status = details.status;
    this.code = details.code;
  }
}

/** Convert a failed API response to a structured error with caller-owned display copy. */
export async function readProblemError(
  response: Response,
  fallback: string,
): Promise<UserFacingError> {
  try {
    const parsed = Problem.safeParse(await response.json());
    return new UserFacingError(fallback, {
      status: response.status,
      ...(parsed.success ? { code: parsed.data.code } : {}),
    });
  } catch {
    return new UserFacingError(fallback, { status: response.status });
  }
}

/** Convert an arbitrary thrown value to a structured error safe to retain in UI state. */
export function toUserFacingError(error: unknown, fallback: string): UserFacingError {
  if (error instanceof UserFacingError) return error;
  return new UserFacingError(fallback, { cause: error });
}

/** Return only application-owned display copy from a trusted structured failure. */
export function userErrorMessage(error: unknown, fallback: string): string {
  return toUserFacingError(error, fallback).message;
}

/** Return safe caller-owned copy for an imperative action that needs inline error state. */
export function readError(error: unknown, fallback: string): string {
  return userErrorMessage(error, fallback);
}
