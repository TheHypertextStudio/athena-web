/**
 * Passkey sign-in button component.
 *
 * @packageDocumentation
 */

'use client';

import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PasskeyButtonProps {
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether auth is in progress */
  loading?: boolean;
  /** Button click handler */
  onClick?: () => void;
}

/**
 * Primary passkey sign-in button.
 */
export function PasskeyButton({ disabled, loading, onClick }: PasskeyButtonProps) {
  return (
    <Button
      type="button"
      size="lg"
      className="h-12 w-full text-base"
      disabled={(disabled ?? false) || loading}
      onClick={onClick}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Authenticating...
        </>
      ) : (
        <>
          <KeyRound className="mr-2 h-5 w-5" />
          Sign in with Passkey
        </>
      )}
    </Button>
  );
}
