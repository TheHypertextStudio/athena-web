/**
 * Single message component for the assistant chat.
 *
 * Renders a user or assistant message with appropriate styling,
 * streaming content, tool calls, and object cards.
 *
 * @packageDocumentation
 */

'use client';

import { useMemo } from 'react';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import { cn } from '@/lib/utils';
import type { AssistantMessage as AssistantMessageType, ChatVariant } from '@/lib/assistant';
import { AssistantTypingIndicator } from './assistant-typing-indicator';

/**
 * Props for AssistantMessage.
 */
export interface AssistantMessageProps {
  /** The message to render */
  message: AssistantMessageType;
  /** Whether this is the last message (affects styling) */
  isLast?: boolean;
  /** Display variant */
  variant?: ChatVariant;
}

/**
 * Renders a single message in the assistant conversation.
 *
 * Handles:
 * - User messages with right alignment
 * - Assistant messages with left alignment
 * - Streaming state with typing indicator
 * - Error state with error styling
 * - Tool calls (placeholder for now)
 * - Object cards (placeholder for now)
 */
export function AssistantMessage({
  message,
  isLast: _isLast = false,
  variant = 'compact',
}: AssistantMessageProps) {
  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming';
  const isError = message.status === 'error';
  const hasContent = message.content.length > 0;

  // Determine if we should show the typing indicator
  const showTypingIndicator = isStreaming && !hasContent;

  // Memoize the time formatting
  const formattedTime = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(message.timestamp);
  }, [message.timestamp]);

  return (
    <div
      className={cn(
        'flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row',
        variant === 'compact' && 'gap-2',
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 rounded-full',
          variant === 'compact' ? 'h-6 w-6' : 'h-8 w-8',
          'flex items-center justify-center',
          isUser
            ? 'bg-primary-container text-on-primary-container'
            : 'bg-tertiary-container text-on-tertiary-container',
        )}
        aria-hidden="true"
      >
        {isUser ? (
          <PersonOutlined sx={{ fontSize: variant === 'compact' ? 14 : 16 }} />
        ) : (
          <AutoAwesomeOutlined sx={{ fontSize: variant === 'compact' ? 14 : 16 }} />
        )}
      </div>

      {/* Message Content */}
      <div
        className={cn(
          'flex flex-col gap-1',
          isUser ? 'items-end' : 'items-start',
          'max-w-[80%]',
          variant === 'compact' && 'max-w-[85%]',
        )}
      >
        {/* Message Bubble */}
        <div
          className={cn(
            'rounded-2xl px-3 py-2',
            variant === 'compact' && 'px-2.5 py-1.5 text-sm',
            isUser
              ? 'bg-primary text-on-primary rounded-br-md'
              : 'bg-surface-container-high text-on-surface rounded-bl-md',
            isError && 'border-error bg-error-container text-on-error-container border',
          )}
        >
          {/* Error icon for error state */}
          {isError && (
            <div className="mb-1 flex items-center gap-1.5">
              <ErrorOutlineOutlined sx={{ fontSize: 16 }} />
              <span className="text-xs font-medium">Error</span>
            </div>
          )}

          {/* Message content or typing indicator */}
          {showTypingIndicator ? (
            <AssistantTypingIndicator size={variant === 'compact' ? 'sm' : 'md'} />
          ) : (
            <div className={cn('break-words whitespace-pre-wrap', isStreaming && 'animate-pulse')}>
              {message.content}
              {/* Blinking cursor for streaming */}
              {isStreaming && hasContent && (
                <span className="animate-blink ml-0.5 inline-block h-4 w-0.5 bg-current" />
              )}
            </div>
          )}
        </div>

        {/* Tool calls (placeholder - will be expanded in Phase 3) */}
        {message.toolCalls.length > 0 && (
          <div className="flex w-full flex-col gap-1.5">
            {message.toolCalls.map((toolCall) => (
              <div
                key={toolCall.id}
                className={cn(
                  'bg-surface-container rounded-lg border px-2.5 py-1.5 text-xs',
                  toolCall.status === 'running' && 'border-primary',
                  toolCall.status === 'complete' && 'border-outline-variant',
                  toolCall.status === 'error' && 'border-error',
                )}
              >
                <span className="text-on-surface-variant">
                  {toolCall.status === 'running' && '⟳ '}
                  {toolCall.status === 'complete' && '✓ '}
                  {toolCall.status === 'error' && '✗ '}
                  {toolCall.name}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Timestamp for non-compact views */}
        {variant !== 'compact' && (
          <span
            className={cn('text-on-surface-variant text-xs', isUser ? 'text-right' : 'text-left')}
          >
            {formattedTime}
          </span>
        )}
      </div>
    </div>
  );
}
