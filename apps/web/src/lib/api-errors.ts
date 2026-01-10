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
  | 'bad_request'
  | 'not_found'
  | 'unknown';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message?: string,
    public details?: string,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
}

export async function mapResponseToError(res: Response): Promise<ApiError> {
  let details: string | undefined;
  try {
    const body = (await res.json()) as ErrorBody;
    details = body.error ?? body.message ?? JSON.stringify(body);
  } catch {
    // Response body not JSON or empty
  }

  const message = `${String(res.status)} ${res.statusText}${details ? `: ${details}` : ''}`;
  console.error(`[API Error] ${res.url} - ${message}`);

  switch (res.status) {
    case 400:
      return new ApiError('bad_request', message, details);
    case 401:
      return new ApiError('unauthorized', message, details);
    case 404:
      return new ApiError('not_found', message, details);
    case 429:
      return new ApiError('rate_limited', message, details);
    case 500:
    case 502:
    case 503:
    case 504:
      return new ApiError('server_error', message, details);
    default:
      return new ApiError('unknown', message, details);
  }
}
