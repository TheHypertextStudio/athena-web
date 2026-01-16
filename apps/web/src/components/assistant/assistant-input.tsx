/**
 * Input component for the assistant chat.
 *
 * Provides a text input with send button for composing messages.
 * Supports multi-line input (Shift+Enter) and keyboard shortcuts.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import { cn } from '@/lib/utils';
import type { ChatVariant } from '@/lib/assistant';

/**
 * Props for AssistantInput.
 */
export interface AssistantInputProps {
  /** Callback when a message is submitted */
  onSubmit: (message: string) => void;
  /** Whether input is disabled (e.g., during streaming) */
  disabled?: boolean;
  /** Whether currently loading/streaming */
  isLoading?: boolean;
  /** Display variant */
  variant?: ChatVariant;
  /** Placeholder text */
  placeholder?: string;
  /** Additional class names */
  className?: string;
  /** Initial value for the input */
  initialValue?: string;
  /** Callback when value changes */
  onValueChange?: (value: string) => void;
}

/**
 * Chat input with send button.
 *
 * Features:
 * - Auto-resizing textarea (in modal/full variants)
 * - Single-line input in compact mode
 * - Enter to send, Shift+Enter for new line
 * - Send button with loading state
 * - Clear after send
 */
export function AssistantInput({
  onSubmit,
  disabled = false,
  isLoading = false,
  variant = 'compact',
  placeholder = 'Message Athena...',
  className,
  initialValue = '',
  onValueChange,
}: AssistantInputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Handle value changes
  const handleChange = useCallback(
    (newValue: string) => {
      setValue(newValue);
      onValueChange?.(newValue);
    },
    [onValueChange],
  );

  // Handle message submission
  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isLoading) return;

    onSubmit(trimmed);
    setValue('');
    onValueChange?.('');

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [value, disabled, isLoading, onSubmit, onValueChange]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter to send (without Shift)
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
        return;
      }

      // In compact mode, prevent newlines entirely
      if (variant === 'compact' && event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, variant],
  );

  // Auto-resize textarea (for non-compact modes)
  const handleInput = useCallback(() => {
    if (!inputRef.current || variant === 'compact') return;

    const textarea = inputRef.current;
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 160))}px`;
  }, [variant]);

  const isDisabled = disabled || isLoading;

  return (
    <div
      className={cn(
        'flex items-end gap-2',
        variant === 'compact' ? 'p-2' : 'p-3',
        variant === 'full' && 'px-6 pb-4',
        'bg-surface-container',
        className,
      )}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => {
          handleChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={placeholder}
        disabled={isDisabled}
        rows={1}
        className={cn(
          'flex-1 resize-none bg-transparent outline-none',
          'text-on-surface placeholder:text-on-surface-variant',
          variant === 'compact' ? 'py-1.5 text-sm' : 'py-2 text-base',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // In compact mode, single line with horizontal scroll
          variant === 'compact' && 'overflow-x-auto whitespace-nowrap',
        )}
        aria-label="Message input"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isDisabled || !value.trim()}
        className={cn(
          'flex-shrink-0 rounded-full p-2',
          'bg-primary text-on-primary',
          'transition-shadow hover:shadow-md',
          'disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none',
          'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          variant === 'compact' && 'p-1.5',
        )}
        aria-label={isLoading ? 'Sending...' : 'Send message'}
      >
        {isLoading ? (
          <SyncOutlined
            sx={{ fontSize: variant === 'compact' ? 16 : 20 }}
            className="animate-spin"
          />
        ) : (
          <SendOutlined sx={{ fontSize: variant === 'compact' ? 16 : 20 }} />
        )}
      </button>
    </div>
  );
}
