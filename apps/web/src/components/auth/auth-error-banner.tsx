/**
 * Auth error banner component.
 *
 * @packageDocumentation
 */

'use client';

import { AlertCircle, X } from 'lucide-react';

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
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <p className="flex-1 text-sm">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="hover:bg-destructive/20 -mt-1 -mr-1 rounded p-1 transition-colors"
          aria-label="Dismiss error"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
