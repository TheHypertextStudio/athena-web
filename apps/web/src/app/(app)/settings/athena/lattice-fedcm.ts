/** Browser-only active FedCM transport for a Docket Lattice authorization attempt. */

/** The start response fields consumed by the browser ceremony. */
export interface LatticeAuthorizationStart {
  readonly attemptId: string;
  readonly expiresAt: string;
  readonly authorizationUrl: string;
  readonly fedcm: {
    readonly configUrl: string;
    readonly clientId: string;
    readonly params: {
      readonly purpose: 'oauth_authorization';
      readonly redirect_uri: string;
      readonly scope: string;
      readonly state: string;
      readonly code_challenge: string;
      readonly code_challenge_method: 'S256';
    };
  };
}

/** Minimal request shape missing from some TypeScript DOM library versions. */
interface ActiveFedCMRequest {
  readonly identity: {
    readonly mode: 'active';
    readonly providers: readonly {
      readonly configURL: string;
      readonly clientId: string;
      readonly params: Readonly<Record<string, string>>;
    }[];
  };
}

/** Injectable browser boundary for deterministic capability and ceremony tests. */
export interface LatticeFedCMEnvironment {
  readonly IdentityCredential?: unknown;
  readonly navigator?: {
    readonly credentials?: {
      get(options: ActiveFedCMRequest): Promise<unknown>;
    };
  };
}

/** The UI action selected by one explicit Connect click. */
export type LatticeFedCMResult =
  | { readonly kind: 'redirect'; readonly authorizationUrl: string }
  | { readonly kind: 'code'; readonly authorizationCode: string }
  | { readonly kind: 'fallback'; readonly authorizationUrl: string };

/** Read a non-empty OAuth code from an opaque browser credential. */
function authorizationCode(credential: unknown): string | null {
  if (typeof credential !== 'object' || credential === null) return null;
  const token: unknown = Reflect.get(credential, 'token');
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Prefer an active native FedCM ceremony, preserving redirect as an explicit fallback.
 *
 * @remarks
 * Unsupported browsers select redirect immediately because no native dialog was invoked. Once a
 * supported browser is asked to show FedCM, every dismissal or failure returns `fallback`; this
 * function never navigates from a catch branch, so closing the native dialog cannot surprise the
 * person with a full-page redirect.
 *
 * @param started - Browser-safe representation of one server-created PKCE attempt.
 * @param environment - Browser capability boundary; injected by tests.
 * @returns A code, an immediate unsupported-browser redirect, or an explicit fallback offer.
 */
export async function requestLatticeFedCM(
  started: LatticeAuthorizationStart,
  environment: LatticeFedCMEnvironment = globalThis as unknown as LatticeFedCMEnvironment,
): Promise<LatticeFedCMResult> {
  const credentials = environment.navigator?.credentials;
  if (!('IdentityCredential' in environment) || typeof credentials?.get !== 'function') {
    return { kind: 'redirect', authorizationUrl: started.authorizationUrl };
  }

  try {
    const credential = await credentials.get({
      identity: {
        mode: 'active',
        providers: [
          {
            configURL: started.fedcm.configUrl,
            clientId: started.fedcm.clientId,
            params: started.fedcm.params,
          },
        ],
      },
    });
    const code = authorizationCode(credential);
    return code
      ? { kind: 'code', authorizationCode: code }
      : { kind: 'fallback', authorizationUrl: started.authorizationUrl };
  } catch {
    return { kind: 'fallback', authorizationUrl: started.authorizationUrl };
  }
}
