/**
 * Sign-in form with passkey and OAuth support.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Separator } from '@/components/ui/separator';
import { usePasskeySupport } from '@/hooks/use-passkey-support';
import { usePasskeyAutofill } from '@/hooks/use-passkey-autofill';
import {
  signInWithPasskey,
  signInWithGoogle,
  signInWithApple,
  signInWithMicrosoft,
} from '@/lib/auth-client';
import { AuthCard } from './auth-card';
import { AuthErrorBanner } from './auth-error-banner';
import { PasskeyButton } from './passkey-button';
import { OAuthButtons } from './oauth-buttons';

type OAuthProvider = 'google' | 'apple' | 'microsoft';

interface SignInFormProps {
  callbackUrl?: string;
}

/**
 * Sign-in form for returning users.
 * Supports passkey authentication and OAuth providers.
 */
export function SignInForm({ callbackUrl = '/home' }: SignInFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);

  const { isSupported: passkeySupported, isLoading: checkingSupport } = usePasskeySupport();

  const handleSuccess = useCallback(() => {
    router.push(callbackUrl);
  }, [router, callbackUrl]);

  const handleError = useCallback((message: string) => {
    setError(message);
    setIsLoading(false);
    setLoadingProvider(null);
  }, []);

  // Passkey autofill - runs once on mount
  usePasskeyAutofill({
    onSuccess: handleSuccess,
    onError: handleError,
    enabled: passkeySupported,
  });

  async function handlePasskeySignIn() {
    setIsLoading(true);
    setError(null);

    try {
      const result = await signInWithPasskey();
      if (result.error) {
        if (
          result.error.message?.includes('aborted') ||
          result.error.message?.includes('cancelled')
        ) {
          setIsLoading(false);
          return;
        }
        handleError(result.error.message ?? 'Passkey authentication failed');
      } else {
        handleSuccess();
      }
    } catch {
      handleError('Passkey authentication failed');
    }
  }

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
      handleError(`Sign in with ${provider} failed`);
    }
  }

  const disabled = isLoading || checkingSupport;

  return (
    <AuthCard>
      {error && (
        <AuthErrorBanner
          message={error}
          onDismiss={() => {
            setError(null);
          }}
        />
      )}

      {/* Passkey sign-in (only for returning users) */}
      {passkeySupported && !checkingSupport && (
        <>
          <PasskeyButton
            onClick={() => void handlePasskeySignIn()}
            disabled={disabled}
            loading={isLoading && !loadingProvider}
          />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background text-muted-foreground px-2">or</span>
            </div>
          </div>
        </>
      )}

      {!passkeySupported && !checkingSupport && (
        <p className="text-muted-foreground text-center text-sm">
          Your browser doesn&apos;t support passkeys.
        </p>
      )}

      <OAuthButtons
        onProviderClick={(provider) => void handleOAuthClick(provider)}
        disabled={disabled}
        loadingProvider={loadingProvider}
      />
    </AuthCard>
  );
}
