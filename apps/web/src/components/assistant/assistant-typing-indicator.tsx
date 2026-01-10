/**
 * Typing indicator for the assistant.
 *
 * Shows a pulsing dots animation while the assistant is thinking
 * or streaming a response.
 *
 * @packageDocumentation
 */

'use client';

import { cn } from '@/lib/utils';

/**
 * Props for AssistantTypingIndicator.
 */
export interface AssistantTypingIndicatorProps {
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

/**
 * Animated typing indicator.
 *
 * Displays three pulsing dots to indicate the assistant is working.
 * Uses MD3 motion tokens for smooth, expressive animation.
 */
export function AssistantTypingIndicator({
  className,
  size = 'md',
}: AssistantTypingIndicatorProps) {
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      role="status"
      aria-label="Assistant is typing"
    >
      <span className="sr-only">Assistant is typing</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(dotSize, 'bg-on-surface-variant rounded-full', 'animate-pulse')}
          style={{
            animationDelay: `${String(i * 150)}ms`,
            animationDuration: '1s',
          }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
