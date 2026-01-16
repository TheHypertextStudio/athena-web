/**
 * Auth error banner component.
 *
 * @packageDocumentation
 */

'use client';

import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';

interface AuthErrorBannerProps {
  /** Error message to display */
  message: string;
  /** Callback to dismiss the error */
  onDismiss?: () => void;
}

/**
 * Banner component for displaying authentication errors.
 */
export function AuthErrorBanner({ message, onDismiss }: AuthErrorBannerProps) {
  return (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive flex items-start gap-3 rounded-lg p-4"
    >
      <ErrorOutlineOutlined sx={{ fontSize: 20 }} className="mt-0.5 flex-shrink-0" />
      <p className="flex-1 text-sm">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="hover:bg-destructive/20 -mt-1 -mr-1 rounded p-1 transition-colors"
          aria-label="Dismiss error"
        >
          <CloseOutlined sx={{ fontSize: 16 }} />
        </button>
      )}
    </div>
  );
}
