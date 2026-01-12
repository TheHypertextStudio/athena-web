/**
 * Message list component for the assistant chat.
 *
 * Renders a scrollable list of messages with auto-scroll behavior
 * when new messages arrive or content streams in.
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
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
  const scrollThrottleRef = useRef(false);
  const autoScrollThrottleRef = useRef<number | null>(null);
  const prevMessageCountRef = useRef(0);
  const wasStreamingRef = useRef(false);

  // Screen reader announcement state
  const [srAnnouncement, setSrAnnouncement] = useState<string>('');

  // Track if user has scrolled away from bottom (throttled)
  const handleScroll = useCallback(() => {
    if (scrollThrottleRef.current) return;
    scrollThrottleRef.current = true;

    requestAnimationFrame(() => {
      if (!containerRef.current) {
        scrollThrottleRef.current = false;
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      // Consider "at bottom" if within 50px of the bottom
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
      scrollThrottleRef.current = false;
    });
  }, []);

  // Auto-scroll when messages change or during streaming (throttled during streaming)
  useEffect(() => {
    if (!containerRef.current || !isAtBottomRef.current) return;

    const container = containerRef.current;

    // During streaming, throttle auto-scroll to prevent excessive updates
    if (isStreaming) {
      if (autoScrollThrottleRef.current !== null) return;

      autoScrollThrottleRef.current = window.setTimeout(() => {
        if (containerRef.current && isAtBottomRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
        autoScrollThrottleRef.current = null;
      }, 50); // 50ms throttle for smooth scrolling during streaming

      return;
    }

    // Not streaming - scroll smoothly
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, isStreaming]);

  // Cleanup throttle timeout on unmount
  useEffect(() => {
    return () => {
      if (autoScrollThrottleRef.current !== null) {
        clearTimeout(autoScrollThrottleRef.current);
      }
    };
  }, []);

  // Always scroll on initial mount
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, []);

  // Announce meaningful events to screen readers (not every character)
  useEffect(() => {
    const messageCount = messages.length;
    const prevCount = prevMessageCountRef.current;
    const wasStreaming = wasStreamingRef.current;

    // New user message sent
    if (messageCount > prevCount && messages[messageCount - 1]?.role === 'user') {
      setSrAnnouncement('Message sent. Waiting for response.');
    }
    // Streaming started (new assistant message appeared)
    else if (messageCount > prevCount && messages[messageCount - 1]?.role === 'assistant') {
      setSrAnnouncement('Athena is responding.');
    }
    // Streaming ended
    else if (wasStreaming && !isStreaming && messageCount > 0) {
      const lastMessage = messages[messageCount - 1];
      if (lastMessage?.role === 'assistant' && lastMessage.status === 'complete') {
        setSrAnnouncement('Response complete.');
      } else if (lastMessage?.role === 'assistant' && lastMessage.status === 'error') {
        setSrAnnouncement('Response failed.');
      }
    }

    prevMessageCountRef.current = messageCount;
    wasStreamingRef.current = isStreaming;
  }, [messages, isStreaming]);

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
    <>
      {/* Screen reader announcements (visually hidden) */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {srAnnouncement}
      </div>

      {/* Message container - no aria-live to prevent announcing every character */}
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
    </>
  );
}
