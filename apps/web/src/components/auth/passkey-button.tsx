/**
 * Passkey sign-in button component.
 *
 * @packageDocumentation
 */

'use client';

import KeyOutlined from '@mui/icons-material/KeyOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
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
          <SyncOutlined sx={{ fontSize: 20 }} className="mr-2 animate-spin" />
          Authenticating...
        </>
      ) : (
        <>
          <KeyOutlined sx={{ fontSize: 20 }} className="mr-2" />
          Sign in with Passkey
        </>
      )}
    </Button>
  );
}
