/**
 * Message list component for the assistant chat.
 *
 * Renders a scrollable list of messages with auto-scroll behavior
 * when new messages arrive or content streams in.
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { AssistantMessage as AssistantMessageType, ChatVariant } from '@/lib/assistant';
import { AssistantMessage } from './assistant-message';

/**
 * Props for AssistantMessages.
 */
export interface AssistantMessagesProps {
  /** Messages to display */
  messages: AssistantMessageType[];
  /** Whether currently streaming a response */
  isStreaming?: boolean;
  /** Display variant */
  variant?: ChatVariant;
  /** Additional class names */
  className?: string;
}

/**
 * Scrollable message list with auto-scroll.
 *
 * Features:
 * - Auto-scrolls to bottom on new messages
 * - Auto-scrolls during streaming (throttled)
 * - Respects user scroll (doesn't auto-scroll if user scrolled up)
 * - Empty state for no messages
 */
export function AssistantMessages({
  messages,
  isStreaming = false,
  variant = 'compact',
  className,
}: AssistantMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track if user has scrolled away from bottom
  const handleScroll = () => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // Consider "at bottom" if within 50px of the bottom
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  // Auto-scroll when messages change or during streaming
  useEffect(() => {
    if (!containerRef.current || !isAtBottomRef.current) return;

    const container = containerRef.current;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: isStreaming ? 'auto' : 'smooth',
    });
  }, [messages, isStreaming]);

  // Always scroll on initial mount
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, []);

  // Empty state
  if (messages.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-1 items-center justify-center p-4',
          variant === 'compact' && 'p-3',
          className,
        )}
      >
        <div className="text-center">
          <p className="text-on-surface-variant text-sm">
            {variant === 'compact' ? 'Ask Athena anything...' : 'Start a conversation with Athena'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={cn(
        'flex-1 overflow-y-auto overscroll-contain',
        variant === 'compact' ? 'space-y-2 p-2' : 'space-y-4 p-4',
        variant === 'full' && 'px-6',
        className,
      )}
      role="log"
      aria-live="polite"
      aria-label="Conversation messages"
    >
      {messages.map((message, index) => (
        <AssistantMessage
          key={message.id}
          message={message}
          isLast={index === messages.length - 1}
          variant={variant}
        />
      ))}
    </div>
  );
}
