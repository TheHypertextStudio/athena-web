/**
 * Streaming content renderer for the assistant.
 *
 * Renders streaming text with token-by-token reveal animation
 * and an optional blinking cursor.
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Props for AssistantStreamingContent.
 */
export interface AssistantStreamingContentProps {
  /** The content to render (may be streaming) */
  content: string;
  /** Whether content is currently streaming */
  isStreaming?: boolean;
  /** Whether to show a blinking cursor */
  showCursor?: boolean;
  /** Animation speed in characters per frame */
  charsPerFrame?: number;
  /** Additional class names */
  className?: string;
}

/**
 * Streaming content with token reveal animation.
 *
 * Features:
 * - Smooth character-by-character reveal animation
 * - Blinking cursor at the end during streaming
 * - Catches up when content arrives faster than animation
 * - Respects whitespace and line breaks
 *
 * @example
 * ```tsx
 * <AssistantStreamingContent
 *   content={message.content}
 *   isStreaming={message.status === 'streaming'}
 * />
 * ```
 */
export function AssistantStreamingContent({
  content,
  isStreaming = false,
  showCursor = true,
  charsPerFrame = 3,
  className,
}: AssistantStreamingContentProps) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const frameRef = useRef<number | null>(null);
  const contentRef = useRef(content);

  // Track content changes
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Animate character reveal
  useEffect(() => {
    // If not streaming, show all content immediately
    if (!isStreaming) {
      setDisplayedLength(content.length);
      return;
    }

    // If already caught up, wait for more content
    if (displayedLength >= content.length) {
      return;
    }

    // Animate revealing characters
    const reveal = () => {
      setDisplayedLength((prev) => {
        const newLength = Math.min(prev + charsPerFrame, contentRef.current.length);

        // Continue animating if there's more content
        if (newLength < contentRef.current.length) {
          frameRef.current = requestAnimationFrame(reveal);
        }

        return newLength;
      });
    };

    frameRef.current = requestAnimationFrame(reveal);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [content, isStreaming, displayedLength, charsPerFrame]);

  // Catch up immediately when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      setDisplayedLength(content.length);
    }
  }, [isStreaming, content.length]);

  // The displayed content
  const displayedContent = useMemo(() => {
    return content.slice(0, displayedLength);
  }, [content, displayedLength]);

  // Whether to show cursor
  const shouldShowCursor = showCursor && isStreaming && displayedLength >= content.length;

  return (
    <div className={cn('break-words whitespace-pre-wrap', className)}>
      {displayedContent}
      {shouldShowCursor && (
        <span
          className="animate-blink ml-0.5 inline-block h-4 w-0.5 bg-current"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
