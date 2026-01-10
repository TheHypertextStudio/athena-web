/**
 * Inline assistant component for the command palette.
 *
 * Renders a compact chat interface within the command palette when
 * in assistant mode. Supports streaming responses and expansion to
 * full modal/page views.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback, useRef, useEffect } from 'react';
import { Maximize2, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useChatStream } from '@/hooks/use-chat-stream';
import { AssistantMessages } from '@/components/assistant/assistant-messages';
import { AssistantInput } from '@/components/assistant/assistant-input';

/**
 * Props for CommandPaletteAssistant.
 */
export interface CommandPaletteAssistantProps {
  /** Initial message to send (from search query) */
  initialMessage?: string;
  /** Callback to exit assistant mode */
  onExit: () => void;
  /** Callback when expand is requested */
  onExpand?: () => void;
}

/**
 * Compact assistant chat for the command palette.
 *
 * Features:
 * - Compact message display (max 3 visible)
 * - Streaming responses
 * - Expand button to open modal/full page
 * - Keyboard navigation (Esc to exit, Enter to send)
 */
export function CommandPaletteAssistant({
  initialMessage,
  onExit,
  onExpand,
}: CommandPaletteAssistantProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasProcessedInitialMessage = useRef(false);

  const { messages, isStreaming, error, sendMessage, clearError, retryLastMessage } = useChatStream(
    { variant: 'compact' },
  );

  // Handle initial message
  useEffect(() => {
    if (initialMessage && !hasProcessedInitialMessage.current) {
      hasProcessedInitialMessage.current = true;
      void sendMessage(initialMessage);
    }
  }, [initialMessage, sendMessage]);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Handle message submission
  const handleSubmit = useCallback(
    (message: string) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  // Handle expand to modal
  const handleExpand = useCallback(() => {
    if (onExpand) {
      onExpand();
    } else {
      // Navigate to assistant route (will be intercepted as modal)
      router.push('/assistant');
    }
  }, [onExpand, router]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Cmd/Ctrl+Shift+E to expand
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'e') {
        event.preventDefault();
        handleExpand();
        return;
      }
    },
    [handleExpand],
  );

  return (
    <div className="flex flex-col" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between px-4 py-2',
          'border-outline-variant border-b',
        )}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExit}
            className={cn(
              '-ml-1 rounded-full p-1.5',
              'text-on-surface-variant hover:text-on-surface',
              'hover:bg-surface-container transition-colors',
              'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
            )}
            aria-label="Back to commands"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-on-surface text-sm font-medium">Athena</span>
          {isStreaming && (
            <span className="text-on-surface-variant animate-pulse text-xs">thinking...</span>
          )}
        </div>

        <button
          type="button"
          onClick={handleExpand}
          className={cn(
            'rounded-full p-1.5',
            'text-on-surface-variant hover:text-on-surface',
            'hover:bg-surface-container transition-colors',
            'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
          )}
          aria-label="Expand to full view"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <AssistantMessages
        messages={messages}
        isStreaming={isStreaming}
        variant="compact"
        className="max-h-[240px]"
      />

      {/* Error banner */}
      {error && (
        <div
          className={cn(
            'flex items-center justify-between gap-2 px-3 py-1.5',
            'bg-error-container text-on-error-container text-xs',
          )}
          role="alert"
        >
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={() => {
              clearError();
              void retryLastMessage();
            }}
            className={cn(
              'flex-shrink-0 rounded px-2 py-0.5',
              'bg-error text-on-error text-[10px] font-medium',
              'transition-shadow hover:shadow-sm',
            )}
          >
            Retry
          </button>
        </div>
      )}

      {/* Input */}
      <AssistantInput
        onSubmit={handleSubmit}
        isLoading={isStreaming}
        variant="compact"
        placeholder="Ask Athena..."
      />

      {/* Footer with hints */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-1.5',
          'text-on-surface-variant text-[10px]',
          'border-outline-variant border-t',
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="bg-surface-container-highest rounded px-1 py-0.5">↵</kbd>
            send
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-surface-container-highest rounded px-1 py-0.5">⌘⇧E</kbd>
            expand
          </span>
        </div>
        <button type="button" onClick={onExit} className="hover:text-on-surface transition-colors">
          esc to exit
        </button>
      </div>
    </div>
  );
}
