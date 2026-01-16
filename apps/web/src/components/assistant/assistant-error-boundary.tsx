/**
 * Error boundary for the assistant chat.
 *
 * Catches React errors in the assistant component tree and provides
 * a recovery UI instead of crashing the entire application.
 *
 * @packageDocumentation
 */

'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import { cn } from '@/lib/utils';
import type { ChatVariant } from '@/lib/assistant';

interface AssistantErrorBoundaryProps {
  /** Children to render */
  children: ReactNode;
  /** Display variant for styling */
  variant?: ChatVariant;
  /** Optional callback when an error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Optional callback when reset is clicked */
  onReset?: () => void;
}

interface AssistantErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary specifically for the assistant chat.
 *
 * Provides a friendly error UI with reset capability.
 */
export class AssistantErrorBoundary extends Component<
  AssistantErrorBoundaryProps,
  AssistantErrorBoundaryState
> {
  constructor(props: AssistantErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): AssistantErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error for debugging
    console.error('[AssistantErrorBoundary] Caught error:', error, errorInfo);

    // Call optional error callback
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { variant = 'compact' } = this.props;

      return (
        <div
          className={cn(
            'flex flex-col items-center justify-center p-6',
            'bg-surface-container text-center',
            variant === 'compact' && 'max-h-[320px]',
            variant === 'modal' && 'h-[60vh] max-h-[600px]',
            variant === 'full' && 'h-full',
          )}
          role="alert"
          aria-live="assertive"
        >
          <div className="bg-error-container mb-4 rounded-full p-3">
            <WarningAmberOutlined sx={{ fontSize: 24 }} className="text-on-error-container" />
          </div>

          <h3 className="text-title-md text-on-surface mb-2 font-medium">Something went wrong</h3>

          <p className="text-body-sm text-on-surface-variant mb-4 max-w-sm">
            The assistant encountered an unexpected error. This won&apos;t affect the rest of the
            app.
          </p>

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre
              className={cn(
                'mb-4 max-w-full overflow-auto rounded p-2 text-left',
                'bg-surface-container-highest text-on-surface text-xs',
              )}
            >
              {this.state.error.message}
            </pre>
          )}

          <button
            type="button"
            onClick={this.handleReset}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-2',
              'bg-primary text-on-primary font-medium',
              'transition-shadow hover:shadow-md',
              'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
            )}
          >
            <RefreshOutlined sx={{ fontSize: 16 }} />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
