/**
 * Main chat component for the assistant.
 *
 * Combines messages, input, and controls into a complete chat interface.
 * Adapts to different display variants (compact, modal, full page).
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { Maximize2, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStream } from '@/hooks/use-chat-stream';
import type { AssistantChatProps } from '@/lib/assistant';
import { AssistantMessages } from './assistant-messages';
import { AssistantInput } from './assistant-input';

/**
 * Complete assistant chat interface.
 *
 * Features:
 * - Message history display
 * - Streaming message input
 * - Error handling with retry
 * - Expand/close controls
 * - Responsive layout for different variants
 */
export function AssistantChat({ variant, className, onExpand, onClose }: AssistantChatProps) {
  const { messages, isStreaming, error, sendMessage, clearError, retryLastMessage } = useChatStream(
    { variant },
  );

  // Handle message submission
  const handleSubmit = useCallback(
    (message: string) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  // Handle retry
  const handleRetry = useCallback(() => {
    clearError();
    void retryLastMessage();
  }, [clearError, retryLastMessage]);

  return (
    <div
      className={cn(
        'flex flex-col',
        variant === 'compact' && 'max-h-[320px]',
        variant === 'modal' && 'h-[60vh] max-h-[600px]',
        variant === 'full' && 'h-full',
        'bg-surface-container overflow-hidden rounded-xl',
        className,
      )}
    >
      {/* Header (for modal and full variants) */}
      {variant !== 'compact' && (
        <header
          className={cn(
            'flex items-center justify-between px-4 py-3',
            'border-outline-variant border-b',
          )}
        >
          <div className="flex items-center gap-2">
            <h2 className="text-title-md text-on-surface font-medium">Athena</h2>
            {isStreaming && (
              <span className="text-on-surface-variant animate-pulse text-xs">thinking...</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Expand button (modal only) */}
            {variant === 'modal' && onExpand && (
              <button
                type="button"
                onClick={onExpand}
                className={cn(
                  'rounded-full p-2',
                  'text-on-surface-variant hover:text-on-surface',
                  'hover:bg-surface-container-highest transition-colors',
                  'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
                )}
                aria-label="Expand to full page"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}

            {/* Close button */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'rounded-full p-2',
                  'text-on-surface-variant hover:text-on-surface',
                  'hover:bg-surface-container-highest transition-colors',
                  'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
                )}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>
      )}

      {/* Messages area */}
      <AssistantMessages
        messages={messages}
        isStreaming={isStreaming}
        variant={variant}
        className="min-h-0 flex-1"
      />

      {/* Error banner */}
      {error && (
        <div
          className={cn(
            'flex items-center justify-between gap-2 px-3 py-2',
            'bg-error-container text-on-error-container text-sm',
          )}
          role="alert"
        >
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={handleRetry}
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-1',
              'bg-error text-on-error text-xs font-medium',
              'transition-shadow hover:shadow-sm',
              'focus-visible:ring-error focus-visible:ring-2 focus-visible:outline-none',
            )}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Input area */}
      <div className={cn('border-outline-variant border-t')}>
        <AssistantInput
          onSubmit={handleSubmit}
          isLoading={isStreaming}
          variant={variant}
          placeholder={variant === 'compact' ? 'Ask Athena...' : 'Message Athena...'}
        />

        {/* Footer with hints (compact variant) */}
        {variant === 'compact' && (
          <div
            className={cn(
              'flex items-center justify-between px-2 pb-2',
              'text-on-surface-variant text-xs',
            )}
          >
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="bg-surface-container-highest rounded px-1 py-0.5 text-[10px]">
                  ↵
                </kbd>
                send
              </span>
              {onExpand && (
                <span className="flex items-center gap-1">
                  <kbd className="bg-surface-container-highest rounded px-1 py-0.5 text-[10px]">
                    ⌘⇧E
                  </kbd>
                  expand
                </span>
              )}
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="hover:text-on-surface transition-colors"
              >
                esc to exit
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
