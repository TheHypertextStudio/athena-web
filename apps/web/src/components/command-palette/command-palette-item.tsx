/**
 * Command palette item component.
 *
 * Renders a single action in the command palette list with:
 * - Icon and label with match highlighting
 * - Keyboard shortcut hint
 * - Staggered entrance animation
 * - Proper ARIA attributes for accessibility
 *
 * @packageDocumentation
 */

'use client';

import { ChevronRight } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import { getShortcutManager, type FuzzyMatch } from '@/lib/command-palette';
import { useCommandPalette } from './command-palette-provider';

/**
 * Props for CommandPaletteItem.
 */
interface CommandPaletteItemProps {
  /** The fuzzy match result containing action and match metadata. */
  match: FuzzyMatch;

  /** Whether this item is currently selected (via keyboard navigation). */
  isSelected: boolean;

  /** Callback when item is hovered (updates selection). */
  onSelect: () => void;

  /** Index in the list (for staggered animation). */
  index: number;
}

/**
 * Render a label with highlighted match ranges.
 *
 * Takes the action label and match ranges from fuzzy search, and returns
 * a React element with matched characters wrapped in highlight spans.
 */
function highlightMatches(label: string, ranges: [number, number][]): React.ReactNode {
  if (ranges.length === 0) {
    return label;
  }

  const result: React.ReactNode[] = [];
  let lastEnd = 0;

  // Sort ranges by start position
  const sortedRanges = [...ranges].sort((a, b) => a[0] - b[0]);

  for (const [start, end] of sortedRanges) {
    // Add text before this match
    if (start > lastEnd) {
      result.push(
        <span key={`pre-${String(start)}`} className="text-on-surface">
          {label.slice(lastEnd, start)}
        </span>,
      );
    }

    // Add highlighted match
    result.push(
      <mark
        key={`match-${String(start)}`}
        className="bg-primary-container text-on-primary-container rounded-sm px-0.5"
      >
        {label.slice(start, end)}
      </mark>,
    );

    lastEnd = end;
  }

  // Add remaining text after last match
  if (lastEnd < label.length) {
    result.push(
      <span key={`post-${String(lastEnd)}`} className="text-on-surface">
        {label.slice(lastEnd)}
      </span>,
    );
  }

  return <>{result}</>;
}

/**
 * Command palette item component.
 *
 * Renders a single action in the palette list with proper accessibility
 * attributes and staggered entrance animation.
 */
export function CommandPaletteItem({
  match,
  isSelected,
  onSelect,
  index,
}: CommandPaletteItemProps) {
  const { pushNavigation, executeAction } = useCommandPalette();
  const { action, matchedRanges } = match;

  const shortcutManager = getShortcutManager();

  /**
   * Handle click/activation on the item.
   * - Groups: Navigate into the group
   * - Actions: Execute the action (or show form)
   */
  const handleClick = useCallback(() => {
    if (action.type === 'group') {
      pushNavigation(action);
    } else {
      void executeAction(action);
    }
  }, [action, pushNavigation, executeAction]);

  /**
   * Handle keyboard activation (Enter or Space).
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const Icon = action.icon;
  const isGroup = action.type === 'group';
  const shortcut = action.type === 'action' ? action.shortcut : undefined;

  // Stagger animation delay based on index (max 8 items, then no more delay)
  const animationDelay = useMemo(() => {
    const delay = Math.min(index, 8) * 30; // 30ms per item, max 240ms
    return `${String(delay)}ms`;
  }, [index]);

  return (
    <div
      id={`palette-item-${action.id}`}
      role="option"
      aria-selected={isSelected}
      data-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5',
        'transition-all outline-none',
        'palette-item-enter',
        isSelected ? 'palette-item-selected' : 'hover:bg-surface-container-high',
      )}
      style={{ animationDelay }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onSelect}
      onFocus={onSelect}
    >
      {/* Icon container */}
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          'duration-short3 transition-colors',
          isSelected
            ? 'bg-primary-container text-on-primary-container'
            : 'bg-surface-container text-on-surface-variant',
        )}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Label with match highlighting */}
      <span className="flex-1 truncate text-sm font-medium">
        {highlightMatches(action.label, matchedRanges)}
      </span>

      {/* Keywords hint (only on hover/selected) */}
      {action.type === 'action' && action.keywords && action.keywords.length > 0 && isSelected && (
        <span className="text-on-surface-variant hidden text-xs sm:inline">
          {action.keywords.slice(0, 2).join(', ')}
        </span>
      )}

      {shortcut && (
        <kbd
          className={cn(
            'duration-short3 hidden rounded-md px-2 py-0.5 text-xs transition-colors sm:inline-block',
            isSelected
              ? 'bg-primary-container/50 text-on-primary-container'
              : 'bg-surface-container-highest text-on-surface-variant',
          )}
          aria-label={`Keyboard shortcut: ${shortcut.keys}`}
        >
          {shortcutManager.formatForDisplay(shortcut.keys)}
        </kbd>
      )}

      {/* Group indicator with rotation animation */}
      {isGroup && (
        <ChevronRight
          className={cn(
            'text-on-surface-variant h-4 w-4 shrink-0',
            'duration-short3 transition-transform',
            isSelected && 'translate-x-0.5',
          )}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
