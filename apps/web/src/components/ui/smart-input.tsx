'use client';

import { forwardRef, useCallback, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  useFieldSuggestions,
  type UseFieldSuggestionsOptions,
} from '@/hooks/use-field-suggestions';

export interface SmartInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange'
> {
  /** Object type for AI suggestions */
  objectType?: UseFieldSuggestionsOptions['objectType'];
  /** Field type for AI suggestions */
  fieldType?: UseFieldSuggestionsOptions['field'];
  /** Context values for AI suggestions */
  suggestionContext?: {
    title?: string;
    description?: string;
  };
  /** Whether AI suggestions are enabled */
  suggestionsEnabled?: boolean;
  /** Callback when value changes */
  onChange?: (value: string) => void;
  /** Current value */
  value?: string;
}

/**
 * Input with inline AI ghost text suggestions.
 *
 * Per HCI guidelines:
 * - Ghost text fades in (150-200ms, ease-out)
 * - Respects prefers-reduced-motion (uses opacity fades only)
 * - Focus states animate smoothly
 * - No loading spinners - graceful degradation
 *
 * Interaction:
 * - Tab: Accept ghost suggestion
 * - Esc: Dismiss suggestion
 * - Continue typing: Suggestion dismissed naturally
 */
export const SmartInput = forwardRef<HTMLInputElement, SmartInputProps>(
  (
    {
      objectType = 'initiative',
      fieldType = 'title',
      suggestionContext = {},
      suggestionsEnabled = true,
      onChange,
      value = '',
      className,
      onKeyDown,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = useState(value);
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync internal value with external value
    useEffect(() => {
      setInternalValue(value);
    }, [value]);

    const { currentSuggestion, accept, dismiss } = useFieldSuggestions({
      objectType,
      field: fieldType,
      context: suggestionContext,
      enabled: suggestionsEnabled && isFocused && !internalValue,
    });

    // Calculate if we should show the ghost text
    const showGhost = Boolean(
      currentSuggestion && isFocused && !internalValue && suggestionsEnabled,
    );

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInternalValue(newValue);
        onChange?.(newValue);

        // Dismiss suggestion when user types
        if (newValue) {
          dismiss();
        }
      },
      [onChange, dismiss],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Tab' && showGhost && currentSuggestion) {
          e.preventDefault();
          accept(currentSuggestion);
          setInternalValue(currentSuggestion);
          onChange?.(currentSuggestion);
        } else if (e.key === 'Escape' && showGhost) {
          e.preventDefault();
          dismiss();
        }

        onKeyDown?.(e);
      },
      [showGhost, currentSuggestion, accept, onChange, dismiss, onKeyDown],
    );

    const handleFocus = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(true);
        onFocus?.(e);
      },
      [onFocus],
    );

    const handleBlur = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(false);
        onBlur?.(e);
      },
      [onBlur],
    );

    // Combine refs
    const setRefs = useCallback(
      (element: HTMLInputElement | null) => {
        if (typeof ref === 'function') {
          ref(element);
        } else if (ref) {
          ref.current = element;
        }
        (inputRef as { current: HTMLInputElement | null }).current = element;
      },
      [ref],
    );

    return (
      <div className="relative">
        <input
          ref={setRefs}
          value={internalValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            // Base styles - matching existing Input component
            'border-input bg-background ring-offset-background',
            'flex h-10 w-full rounded-md border px-3 py-2',
            'text-base md:text-sm',
            'file:border-0 file:bg-transparent file:text-sm file:font-medium',
            'placeholder:text-muted-foreground',
            // Focus state with smooth transition (per HCI: 150-200ms, ease-out)
            'transition-[border-color,box-shadow] duration-150 ease-out',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            // Disabled state
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        {/* Ghost text overlay - fades in per HCI guidelines */}
        <span
          className={cn(
            'pointer-events-none absolute top-0 left-0 flex h-10 items-center px-3 py-2',
            'text-muted-foreground/50 text-base md:text-sm',
            // Transition: 150-200ms, ease-out per HCI guidelines
            // Using only opacity for prefers-reduced-motion compliance
            'transition-opacity duration-200 ease-out',
            'motion-reduce:duration-0',
            showGhost ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden="true"
        >
          {currentSuggestion}
        </span>
      </div>
    );
  },
);

SmartInput.displayName = 'SmartInput';
