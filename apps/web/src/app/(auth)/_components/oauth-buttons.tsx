'use client';

/**
 * `(auth)/_components/oauth-buttons` — the secondary OAuth provider buttons.
 *
 * @remarks
 * Renders nothing unless at least one provider is configured — availability comes from the
 * server's `/v1/config` ({@link usePublicConfig}), so local/passkey-only deployments show no dead
 * buttons and the client never mirrors OAuth setup into a build-time flag. When providers exist it
 * renders a labelled `"or continue with"` divider followed by one outline button per provider;
 * clicking redirects through Better Auth's `signIn.social`. The group is disabled while any auth
 * attempt is pending so the user cannot start two ceremonies at once.
 */
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { authClient } from '@/lib/auth-client';
import { usePublicConfig } from '@/lib/public-config';

import { oauthProviderOptions, type OAuthProvider } from '../_lib/oauth-providers';

/** Props for {@link OAuthButtons}. */
export interface OAuthButtonsProps {
  /** Where to land after a successful OAuth round-trip (e.g. `/onboarding` or `/today`). */
  callbackURL: string;
  /** Disable every provider button (e.g. while a passkey ceremony is in flight). */
  disabled: boolean;
  /** Surface a provider redirect failure to the parent for inline display. */
  onError: (message: string) => void;
}

/**
 * The OAuth provider button group, or `null` when no provider is configured (or still loading).
 */
export function OAuthButtons({
  callbackURL,
  disabled,
  onError,
}: OAuthButtonsProps): JSX.Element | null {
  const { data: config } = usePublicConfig();
  const providers = oauthProviderOptions(config?.oauthProviders ?? []);
  if (providers.length === 0) return null;

  /** Begin the OAuth redirect for `provider`, reporting a failure if the call rejects. */
  async function continueWith(provider: OAuthProvider['id']): Promise<void> {
    try {
      // Resolve to an ABSOLUTE URL on the current origin. The `oAuthProxy` social flow relays the
      // callback through the API host and resolves a relative `callbackURL` against *that* host —
      // landing the user on `api.docket.localhost/<path>` (a 404) instead of the app. Pinning the
      // origin keeps the post-login redirect on the host the user is actually browsing.
      const absoluteCallbackURL = new URL(callbackURL, window.location.origin).toString();
      await authClient.signIn.social({ provider, callbackURL: absoluteCallbackURL });
    } catch {
      onError('Could not reach that provider. Please try again.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="bg-outline-variant h-px flex-1" />
        <span className="text-on-surface-variant text-xs font-medium">or continue with</span>
        <span className="bg-outline-variant h-px flex-1" />
      </div>
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              void continueWith(provider.id);
            }}
          >
            {provider.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
