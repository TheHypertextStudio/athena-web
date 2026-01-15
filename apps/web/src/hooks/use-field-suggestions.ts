'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { aiApi, type AICompletionsRequest } from '@/lib/api-client';

export interface UseFieldSuggestionsOptions {
  objectType: AICompletionsRequest['context']['objectType'];
  field: AICompletionsRequest['context']['field'];
  context: {
    title?: string;
    description?: string;
  };
  debounceMs?: number;
  enabled?: boolean;
}

export interface UseFieldSuggestionsReturn {
  suggestions: string[];
  isLoading: boolean;
  accept: (suggestion: string) => void;
  dismiss: () => void;
  currentSuggestion: string | null;
}

/**
 * Hook for fetching AI field suggestions with debouncing.
 *
 * Per HCI guidelines:
 * - Suggestions appear after an intentional pause (500ms default)
 * - No loading spinners (graceful degradation)
 * - Escape hatch via dismiss()
 * - User can always ignore suggestions
 *
 * @example
 * ```tsx
 * const { suggestions, currentSuggestion, accept, dismiss } = useFieldSuggestions({
 *   objectType: 'initiative',
 *   field: 'title',
 *   context: { description: 'Learn piano by end of year' },
 * });
 *
 * // Tab to accept: accept(currentSuggestion)
 * // Esc to dismiss: dismiss()
 * ```
 */
export function useFieldSuggestions({
  objectType,
  field,
  context,
  debounceMs = 500,
  enabled = true,
}: UseFieldSuggestionsOptions): UseFieldSuggestionsReturn {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track previous context to detect changes
  const prevContextRef = useRef<string>('');

  // Determine if we have enough context to suggest
  const hasContext =
    field === 'title'
      ? Boolean(context.description && context.description.length >= 10)
      : Boolean(context.title && context.title.length >= 3);

  // Serialize context for comparison
  const contextKey = JSON.stringify({ objectType, field, ...context });

  // Reset dismissed state when context changes
  useEffect(() => {
    if (prevContextRef.current !== contextKey) {
      setDismissed(false);
      prevContextRef.current = contextKey;
    }
  }, [contextKey]);

  // Fetch suggestions with debouncing
  useEffect(() => {
    if (!enabled || !hasContext || dismissed) {
      setSuggestions([]);
      return;
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Debounce the API call
    timeoutRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);

      aiApi
        .getCompletions({
          type: 'field_suggestion',
          context: {
            objectType,
            field,
            values: context,
          },
        })
        .then((response) => {
          if (!controller.signal.aborted) {
            setSuggestions(response.completions);
          }
        })
        .catch(() => {
          // Gracefully degrade - no suggestions is fine
          if (!controller.signal.aborted) {
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        });
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [objectType, field, context, debounceMs, enabled, hasContext, dismissed]);

  const accept = useCallback((suggestion: string) => {
    // After accepting, clear suggestions
    setSuggestions([]);
    // Return the suggestion for the caller to use
    return suggestion;
  }, []);

  const dismiss = useCallback(() => {
    setSuggestions([]);
    setDismissed(true);
  }, []);

  // Get the first suggestion for ghost text display
  const currentSuggestion: string | null = suggestions.length > 0 ? (suggestions[0] ?? null) : null;

  return {
    suggestions,
    isLoading,
    accept,
    dismiss,
    currentSuggestion,
  };
}
