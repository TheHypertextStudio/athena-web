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
import type { JSX, SVGProps } from 'react';

import { authClient } from '@/lib/auth-client';
import { usePublicConfig } from '@/lib/public-config';

import { oauthProviderOptions, type OAuthProvider } from '../_lib/oauth-providers';

/**
 * The Apple logo glyph. `fill="currentColor"` so it inherits the button's text color — which flips
 * with the theme tokens (white on the light-theme black button, black on the dark-theme white one).
 */
function AppleLogo(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.2 40.8s-104.9-57-154.8-127C46.5 754.5 0 622 0 496.1c0-202 131.3-309.1 260.5-309.1 68.7 0 126 45.2 169.2 45.2 41.1 0 105.1-47.9 183.3-47.9 29.6 0 136.1 2.7 205.8 102.6zm-243-187.8c32.3-38.3 55.1-91.5 55.1-144.7 0-7.4-.6-14.9-2-21-52.5 2-114.9 35-152.5 78.7-29.6 33.6-57.2 86.8-57.2 140.7 0 8.1 1.3 16.2 1.9 18.8 3.3.6 8.7 1.3 14.1 1.3 47.1 0 106.3-31.5 140.6-73.8z" />
    </svg>
  );
}

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
  const providers = oauthProviderOptions(config?.oauthProviders ?? []).filter(
    (provider) => provider.id !== 'google' || config?.googleOAuthPublic === true,
  );
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
        {providers.map((provider) =>
          provider.id === 'apple' ? (
            // Apple's Human Interface Guidelines require its own button treatment. `on-surface`/
            // `surface` tokens render it black-on-light and white-on-dark — the exact flip Apple
            // prescribes for light vs dark backgrounds — while staying on the design system (no
            // hardcoded hex). The logo + label are pinned white/black via `text-surface`.
            <Button
              key={provider.id}
              type="button"
              disabled={disabled}
              className="bg-on-surface text-surface hover:bg-on-surface/90"
              onClick={() => {
                void continueWith(provider.id);
              }}
            >
              <AppleLogo />
              {provider.label}
            </Button>
          ) : (
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
          ),
        )}
      </div>
    </div>
  );
}
