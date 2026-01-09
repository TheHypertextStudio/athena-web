/**
 * Hook for detecting WebAuthn/passkey browser support.
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useState } from 'react';

interface PasskeySupportState {
  /** Whether the browser supports WebAuthn */
  isSupported: boolean;
  /** Whether the browser supports conditional UI (autofill) */
  isConditionalUISupported: boolean;
  /** Whether the check is still loading */
  isLoading: boolean;
}

/**
 * Hook to check if the browser supports passkeys (WebAuthn).
 *
 * @returns Passkey support state including conditional UI availability
 *
 * @example
 * ```tsx
 * const { isSupported, isConditionalUISupported, isLoading } = usePasskeySupport();
 *
 * if (!isSupported) {
 *   return <p>Your browser doesn't support passkeys</p>;
 * }
 * ```
 */
export function usePasskeySupport(): PasskeySupportState {
  const [state, setState] = useState<PasskeySupportState>({
    isSupported: false,
    isConditionalUISupported: false,
    isLoading: true,
  });

  useEffect(() => {
    async function checkSupport() {
      // Check basic WebAuthn support
      const isSupported =
        typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

      if (!isSupported) {
        setState({
          isSupported: false,
          isConditionalUISupported: false,
          isLoading: false,
        });
        return;
      }

      // Check conditional UI support (for autofill)
      let isConditionalUISupported = false;
      try {
        if (typeof PublicKeyCredential.isConditionalMediationAvailable === 'function') {
          isConditionalUISupported = await PublicKeyCredential.isConditionalMediationAvailable();
        }
      } catch {
        // Conditional UI not supported
        isConditionalUISupported = false;
      }

      setState({
        isSupported: true,
        isConditionalUISupported,
        isLoading: false,
      });
    }

    void checkSupport();
  }, []);

  return state;
}
