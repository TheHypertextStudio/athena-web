/**
 * Typed API error handling.
 *
 * @packageDocumentation
 */

export type ApiErrorCode =
  | 'rate_limited'
  | 'unauthorized'
  | 'forbidden'
  | 'entitlement_required'
  | 'server_error'
  | 'network_error'
  | 'bad_request'
  | 'not_found'
  | 'unknown';

export interface EntitlementErrorInfo {
  requiredEntitlement: string;
  requiredPlan: string;
  currentPlan: string;
  upgradeUrl: string;
}

export class ApiError extends Error {
  public entitlementInfo?: EntitlementErrorInfo;

  constructor(
    public code: ApiErrorCode,
    message?: string,
    public details?: string,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }

  /**
   * Check if this error is due to missing entitlement.
   */
  isEntitlementError(): this is ApiError & { entitlementInfo: EntitlementErrorInfo } {
    return this.code === 'entitlement_required' && this.entitlementInfo !== undefined;
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
  required_entitlement?: string;
  required_plan?: string;
  current_plan?: string;
  upgrade_url?: string;
}

export async function mapResponseToError(res: Response): Promise<ApiError> {
  let details: string | undefined;
  let body: ErrorBody | undefined;

  try {
    body = (await res.json()) as ErrorBody;
    details = body.error ?? body.message ?? JSON.stringify(body);
  } catch {
    // Response body not JSON or empty
  }

  const message = `${String(res.status)} ${res.statusText}${details ? `: ${details}` : ''}`;
  console.error(`[API Error] ${res.url} - ${message}`);

  // Handle 403 with entitlement error
  if (res.status === 403 && body?.error === 'entitlement_required') {
    const error = new ApiError('entitlement_required', message, details);
    error.entitlementInfo = {
      requiredEntitlement: body.required_entitlement ?? '',
      requiredPlan: body.required_plan ?? 'pro',
      currentPlan: body.current_plan ?? 'free',
      upgradeUrl: body.upgrade_url ?? '/settings/billing',
    };
    return error;
  }

  switch (res.status) {
    case 400:
      return new ApiError('bad_request', message, details);
    case 401:
      return new ApiError('unauthorized', message, details);
    case 403:
      return new ApiError('forbidden', message, details);
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
