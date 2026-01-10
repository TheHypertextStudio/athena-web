/**
 * Typed API error handling.
 *
 * @packageDocumentation
 */

export type ApiErrorCode =
  | 'rate_limited'
  | 'unauthorized'
  | 'server_error'
  | 'network_error'
  | 'unknown';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

export function mapStatusToError(status: number): ApiError {
  switch (status) {
    case 401:
      return new ApiError('unauthorized');
    case 429:
      return new ApiError('rate_limited');
    case 500:
    case 502:
    case 503:
    case 504:
      return new ApiError('server_error');
    default:
      return new ApiError('unknown');
  }
}
