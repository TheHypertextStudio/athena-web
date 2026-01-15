/**
 * Hook for handling passkey autofill (conditional UI).
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { signInWithPasskeyAutofill } from '@/lib/auth-client';

interface UsePasskeyAutofillOptions {
  /** Callback when passkey authentication succeeds */
  onSuccess: () => void;
  /** Callback when passkey authentication fails */
  onError: (error: string) => void;
  /** Whether to enable autofill (default: true) */
  enabled?: boolean;
}

/**
 * Hook to handle passkey autofill (conditional UI) for sign-in.
 *
 * Triggers ONCE on mount when enabled. Does not retry on errors.
 */
export function usePasskeyAutofill(options: UsePasskeyAutofillOptions): void {
  const { onSuccess, onError, enabled = true } = options;
  const [hasRun, setHasRun] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Store callbacks in refs to avoid triggering effect
  const callbacksRef = useRef({ onSuccess, onError });
  callbacksRef.current = { onSuccess, onError };

  useEffect(() => {
    // Only run once, and only if enabled
    if (!enabled || hasRun) return;

    setHasRun(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const runAutofill = async () => {
      try {
        // Passkey autofill requires an input with autocomplete="webauthn"
        // Skip if no such input exists to avoid console errors
        const webauthnInput = document.querySelector('input[autocomplete*="webauthn"]');
        if (!webauthnInput) {
          return;
        }

        const result = await signInWithPasskeyAutofill({
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (result.error) {
          // Silently ignore user cancellation or no passkey
          const msg = result.error.message ?? '';
          if (
            msg.includes('aborted') ||
            msg.includes('cancelled') ||
            msg.includes('NotAllowedError')
          ) {
            return;
          }
          // Don't show errors for autofill - it's a background feature
          // Only log for debugging
          console.debug('Passkey autofill error:', msg);
        } else {
          callbacksRef.current.onSuccess();
        }
      } catch {
        // Silently fail - autofill is optional
      }
    };

    void runAutofill();

    return () => {
      controller.abort();
    };
  }, [enabled, hasRun]);
}
