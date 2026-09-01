'use client';

/**
 * `(auth)/_components/oauth-sign-in` — the identity-provider sign-in controls.
 *
 * @remarks
 * Docket is passwordless. Passkeys are the *primary* credential and stay the primary control on
 * `/sign-in`; these are the secondary path for someone who would rather bring an account they
 * already have, and for the ordinary case of a device with no passkey on it yet.
 *
 * **Availability is server truth, never a build-time flag.** The buttons come from
 * `GET /v1/config`'s `oauthProviders`, which the API derives from whether each provider's OAuth
 * client id *and* secret are actually configured (`configuredSocialProviders`). The type contract
 * has said "the sign-in page renders exactly these buttons" since the field was added; this is the
 * component that finally makes that true. Where nothing is configured — the local stack, where
 * every credential is blank — the whole block renders `null` and the screen is passkey-only
 * exactly as before. Offering a provider that cannot complete would be the connector-reliability
 * failure in a different costume: a control that looks like it works, and a dead end behind it.
 *
 * **Google carries a second gate.** `canUseGoogleOAuth` (`packages/auth`) restricts Google to an
 * allowlist of test emails while `GOOGLE_OAUTH_PUBLIC` is false in production. That check keys on
 * the account's email, which nobody has typed yet at sign-in time, so the only honest thing the
 * pre-identity screen can do is decline to offer Google at all until the stage is public. See
 * {@link isOfferable}.
 *
 * @see {@link file://./sign-in-client.tsx} for the passkey ceremony this sits beneath.
 */
import type {
  PublicConfigOut,
  SignInProvider,
} from '@docket/identity-access/public-config-contract';
import { Apple, Github, Google, Layers, ListChecks, type LucideIcon } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { type JSX, useCallback, useState } from 'react';

import { safeSameOriginPath } from '@/components/app-shell-utils';
import { authClient } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';
import { usePublicConfig } from '@/lib/public-config';

import { AuthError, Spinner } from './auth-feedback';

/**
 * Where the provider returns the browser once a session exists.
 *
 * @remarks
 * `/open` rather than `/today`: it is a Server Component that reads the session and redirects, so
 * the destination is resolved with the session in hand instead of being guessed here. A returning
 * user who was bounced out of a protected route carries a `?callbackURL=`, and that wins.
 */
const RETURN_DESTINATION = '/open';

/** Where a brand-new account lands — it belongs to no organization yet. */
const NEW_ACCOUNT_DESTINATION = '/onboarding';

/** How each offerable provider presents itself. */
interface ProviderPresentation {
  /** The Better Auth `socialProviders` key. */
  readonly id: SignInProvider;
  /** The provider's own name, as its own brand spells it. */
  readonly name: string;
  /** The brand glyph. */
  readonly icon: LucideIcon;
}

/**
 * Every provider the server can advertise, in display order.
 *
 * @remarks
 * Keyed by {@link SignInProvider} so adding a provider to the shared enum fails to typecheck until
 * it has a label and a glyph here — the catalog cannot silently fall behind the contract. Linear
 * and Notion have no brand glyph in the curated icon set, so they borrow the marks the Connected
 * accounts directory already uses for them.
 */
const PROVIDERS: Readonly<Record<SignInProvider, ProviderPresentation>> = {
  google: { id: 'google', name: 'Google', icon: Google },
  apple: { id: 'apple', name: 'Apple', icon: Apple },
  github: { id: 'github', name: 'GitHub', icon: Github },
  linear: { id: 'linear', name: 'Linear', icon: Layers },
  notion: { id: 'notion', name: 'Notion', icon: ListChecks },
};

/** Display order — the two consumer identities first, then the work ones. */
const PROVIDER_ORDER: readonly SignInProvider[] = ['google', 'apple', 'github', 'linear', 'notion'];

/**
 * Whether this deployment can actually complete a sign-in with `provider` for an unknown person.
 *
 * @remarks
 * Configured is necessary but not sufficient for Google: while `googleOAuthPublic` is false, a
 * production deployment only admits the allowlisted test emails, and the sign-in screen has no
 * email to test against. Rather than send most people into a grant that the server will refuse,
 * the button is withheld until the stage opens. Every other provider is offerable as soon as its
 * credentials exist.
 *
 * @param config - The fetched public config.
 * @param provider - The provider being considered.
 * @returns `true` when the button should be rendered.
 */
export function isOfferable(config: PublicConfigOut, provider: SignInProvider): boolean {
  if (!config.oauthProviders.includes(provider)) return false;
  if (provider !== 'google') return true;
  return config.appMode !== 'production' || config.googleOAuthPublic === true;
}

/**
 * The safe `?callbackURL=` return-to path, or `null`.
 *
 * @remarks
 * Shares {@link safeSameOriginPath} with the passkey path, which is the single open-redirect
 * guard every auth-adjacent return path in the app goes through. It matters more here than there:
 * this value is handed to the provider and comes back through a cross-origin redirect.
 */
function safeCallbackPath(): string | null {
  if (typeof window === 'undefined') return null;
  return safeSameOriginPath(new URLSearchParams(window.location.search).get('callbackURL'));
}

/**
 * The identity-provider sign-in buttons, or `null` when this deployment offers none.
 *
 * @remarks
 * Renders nothing at all while the config read is in flight — a row of provider buttons that
 * appears and then vanishes is worse than one that arrives a beat late, and the passkey control
 * above it is already interactive.
 *
 * Each button is `size="lg"` (40px) to clear the craft rubric's mobile touch-target gate, and
 * `variant="outline"` so the passkey button stays the one filled, primary action on the screen.
 *
 * @returns The provider block, or `null`.
 */
export function OAuthSignIn(): JSX.Element | null {
  const { data: config } = usePublicConfig();
  const [pendingProvider, setPendingProvider] = useState<SignInProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback((provider: SignInProvider): void => {
    setError(null);
    setPendingProvider(provider);
    // A full top-level navigation to the provider, not a fetch: the ceremony leaves the origin and
    // returns through Better Auth's callback, which is what sets the session cookie.
    authClient.signIn
      .social({
        provider,
        callbackURL: safeCallbackPath() ?? RETURN_DESTINATION,
        newUserCallbackURL: NEW_ACCOUNT_DESTINATION,
      })
      .catch((caught: unknown) => {
        setError(userErrorMessage(caught, 'We could not start that sign-in. Please try again.'));
        setPendingProvider(null);
      });
  }, []);

  if (!config) return null;
  const offered = PROVIDER_ORDER.filter((provider) => isOfferable(config, provider));
  if (offered.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* A labelled rule, not a bare one: it names what the alternative is instead of leaving a
          decorative line between two stacks of buttons. */}
      <div className="text-on-surface-variant flex items-center gap-3">
        <span className="bg-outline-variant h-px flex-1" aria-hidden="true" />
        <span className="text-label-medium">or continue with</span>
        <span className="bg-outline-variant h-px flex-1" aria-hidden="true" />
      </div>

      <AuthError message={error} />

      <div className="flex flex-col gap-2">
        {offered.map((provider) => {
          const { name, icon: Icon } = PROVIDERS[provider];
          const pending = pendingProvider === provider;
          return (
            <Button
              key={provider}
              type="button"
              size="lg"
              variant="outline"
              className="relative"
              disabled={pendingProvider !== null}
              data-testid={`oauth-sign-in-${provider}`}
              onClick={() => {
                start(provider);
              }}
            >
              {/* Pinned to the button's own content inset (`left-8` matches `size="lg"`'s `px-8`)
                  rather than sitting inline beside the label. Inline, the glyph's left edge moves
                  with the label's width — measured at a 3.9px wobble across the four providers,
                  because centring fixes the group's midpoint, not its start. Absolute puts the
                  glyph column dead straight down the list while the label stays optically centred.
                  The glyph renders at 24px: `buttonVariants`' `[&_svg]:size-6` is a descendant rule
                  and outranks a size utility on the svg itself, which is the primitive's call to
                  make and is what every other button in the app does. */}
              <span className="absolute left-8 flex items-center justify-center" aria-hidden="true">
                {pending ? <Spinner /> : <Icon />}
              </span>
              {pending ? `Opening ${name}…` : `Continue with ${name}`}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
