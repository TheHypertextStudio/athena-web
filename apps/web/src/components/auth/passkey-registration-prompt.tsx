/**
 * Passkey registration prompt component.
 *
 * @packageDocumentation
 */

'use client';

import { useState } from 'react';
import { KeyRound, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { registerPasskey } from '@/lib/auth-client';

interface PasskeyRegistrationPromptProps {
  /** Whether the prompt is visible */
  open: boolean;
  /** Callback when registration completes */
  onComplete: () => void;
  /** Callback when user skips registration */
  onSkip: () => void;
}

/**
 * Prompt shown after OAuth sign-in to encourage passkey registration.
 */
export function PasskeyRegistrationPrompt({
  open,
  onComplete,
  onSkip,
}: PasskeyRegistrationPromptProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleRegister() {
    setIsLoading(true);
    setError(null);

    try {
      const result = await registerPasskey();
      if (result.error) {
        setError(result.error.message ?? 'Failed to register passkey');
      } else {
        onComplete();
      }
    } catch {
      setError('Failed to register passkey');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="relative">
          <button
            type="button"
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded p-1 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <KeyRound className="text-primary h-8 w-8" />
          </div>
          <CardTitle className="text-center">Add a Passkey</CardTitle>
          <CardDescription className="text-center">
            Sign in faster next time using your device&apos;s biometrics or PIN
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">{error}</div>
          )}
          <Button
            type="button"
            className="w-full"
            onClick={() => void handleRegister()}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Setting up...
              </>
            ) : (
              'Add Passkey'
            )}
          </Button>
          <Button
            type="button"
            variant="text"
            className="w-full"
            onClick={onSkip}
            disabled={isLoading}
          >
            Maybe Later
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
