/**
 * Sign-up form with OAuth only.
 *
 * Passkeys require an existing account, so sign-up only offers OAuth.
 * After account creation, users are prompted to register a passkey.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePasskeySupport } from '@/hooks/use-passkey-support';
import { signInWithGoogle, signInWithApple, signInWithMicrosoft } from '@/lib/auth-client';
import { AuthCard } from './auth-card';
import { AuthErrorBanner } from './auth-error-banner';
import { OAuthButtons } from './oauth-buttons';
import { PasskeyRegistrationPrompt } from './passkey-registration-prompt';

type OAuthProvider = 'google' | 'apple' | 'microsoft';

interface SignUpFormProps {
  callbackUrl?: string;
}

/**
 * Sign-up form for new users.
 * Only supports OAuth - passkeys require an existing account.
 */
export function SignUpForm({ callbackUrl = '/home' }: SignUpFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);
  const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false);

  const { isSupported: passkeySupported } = usePasskeySupport();

  const handleError = useCallback((message: string) => {
    setError(message);
    setIsLoading(false);
    setLoadingProvider(null);
  }, []);

  async function handleOAuthClick(provider: OAuthProvider) {
    setIsLoading(true);
    setLoadingProvider(provider);
    setError(null);

    try {
      const signInFn = {
        google: signInWithGoogle,
        apple: signInWithApple,
        microsoft: signInWithMicrosoft,
      }[provider];

      await signInFn();
      // OAuth redirects, so we won't reach here unless there's an error
    } catch {
      handleError(`Sign up with ${provider} failed`);
    }
  }

  function handlePasskeyPromptComplete() {
    setShowPasskeyPrompt(false);
    router.push(callbackUrl);
  }

  function handlePasskeyPromptSkip() {
    setShowPasskeyPrompt(false);
    router.push(callbackUrl);
  }

  return (
    <>
      <AuthCard>
        {error && (
          <AuthErrorBanner
            message={error}
            onDismiss={() => {
              setError(null);
            }}
          />
        )}

        <OAuthButtons
          onProviderClick={(provider) => void handleOAuthClick(provider)}
          disabled={isLoading}
          loadingProvider={loadingProvider}
        />

        {passkeySupported && (
          <p className="text-muted-foreground text-center text-xs">
            After signing up, you can add a passkey for faster sign-in.
          </p>
        )}
      </AuthCard>

      <PasskeyRegistrationPrompt
        open={showPasskeyPrompt}
        onComplete={handlePasskeyPromptComplete}
        onSkip={handlePasskeyPromptSkip}
      />
    </>
  );
}
