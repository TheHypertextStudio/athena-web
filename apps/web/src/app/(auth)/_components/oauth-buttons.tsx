'use client';

/**
 * `(auth)/_components/oauth-buttons` — the secondary, env-gated OAuth provider buttons.
 *
 * @remarks
 * Renders nothing unless at least one provider is configured (see
 * {@link configuredOAuthProviders}), so local/passkey-only deployments show no dead buttons.
 * When providers exist it renders a labelled `"or continue with"` divider followed by one
 * outline button per provider; clicking redirects through Better Auth's `signIn.social`. The
 * group is disabled while any auth attempt is pending so the user cannot start two ceremonies
 * at once.
 */
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { authClient } from '@/lib/auth-client';

import { configuredOAuthProviders, type OAuthProvider } from '../_lib/oauth-providers';

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
 * The env-gated OAuth provider button group, or `null` when no provider is configured.
 */
export function OAuthButtons({
  callbackURL,
  disabled,
  onError,
}: OAuthButtonsProps): JSX.Element | null {
  const providers = configuredOAuthProviders();
  if (providers.length === 0) return null;

  /** Begin the OAuth redirect for `provider`, reporting a failure if the call rejects. */
  async function continueWith(provider: OAuthProvider['id']): Promise<void> {
    try {
      await authClient.signIn.social({ provider, callbackURL });
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
