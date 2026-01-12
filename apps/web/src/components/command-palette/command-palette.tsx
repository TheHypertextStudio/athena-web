/**
 * Command palette dialog component.
 *
 * This is the main UI component for the command palette. It renders as a
 * modal dialog that appears when the user presses Cmd+K / Ctrl+K.
 *
 * ## Accessibility
 *
 * - Uses `role="combobox"` pattern for search + listbox
 * - Full keyboard navigation with Tab, Arrow keys, Enter, Escape
 * - Screen reader announcements for search results
 * - Focus trap within the dialog
 * - Proper ARIA labels and relationships
 *
 * ## Animations
 *
 * Uses MD3 motion tokens for smooth, expressive animations:
 * - Emphasized decelerate easing for opening (feeling of arrival)
 * - Emphasized accelerate easing for closing (quick departure)
 * - Staggered list items for visual delight
 *
 * @packageDocumentation
 */

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Search, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { getShortcutManager } from '@/lib/command-palette';
import { useCommandPalette } from './command-palette-provider';
import { CommandPaletteItem } from './command-palette-item';
import { CommandPaletteForm } from './command-palette-form';
import { CommandPaletteAssistant } from './command-palette-assistant';
import { AssistantErrorBoundary } from '@/components/assistant';

/**
 * Main command palette component.
 *
 * Renders a modal dialog with search input, action list, and inline forms.
 * Uses Radix UI Dialog for accessible modal behavior with custom animations.
 */
export function CommandPalette() {
  const {
    isOpen,
    mode,
    close,
    query,
    setQuery,
    filteredActions,
    selectedIndex,
    setSelectedIndex,
    navigationStack,
    popNavigation,
    clearNavigation,
    activeAction,
    setActiveAction,
    isExecuting,
    pushNavigation,
    executeAction,
    enterAssistantMode,
    exitAssistantMode,
    assistantInitialMessage,
    shouldShowAssistantHint,
  } = useCommandPalette();

  const router = useRouter();

  // Generate unique IDs for ARIA relationships
  const inputId = useId();
  const listboxId = useId();
  const labelId = useId();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Focus input when palette opens
  useEffect(() => {
    if (!isOpen || !inputRef.current) {
      return;
    }
    // Small delay to ensure dialog is mounted and animation started
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => {
      clearTimeout(timer);
    };
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current || activeAction) return;

    const selectedElement = listRef.current.querySelector('[data-selected="true"]');
    if (selectedElement) {
      selectedElement.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex, activeAction]);

  // Handle keyboard navigation within the palette
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // In assistant mode, let the assistant component handle keys
      if (mode === 'assistant') {
        if (event.key === 'Escape') {
          event.preventDefault();
          exitAssistantMode();
        }
        return;
      }

      // Handle form mode separately
      if (activeAction) {
        if (event.key === 'Escape') {
          event.preventDefault();
          // Exit form mode - clear active action and form data
          setActiveAction(null);
        }
        // Let form handle other keys (Tab, Enter, etc.)
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex(Math.min(selectedIndex + 1, filteredActions.length - 1));
          break;

        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex(Math.max(selectedIndex - 1, 0));
          break;

        case 'Tab':
          // Allow tab navigation within the palette
          // Radix Dialog handles focus trapping
          break;

        case 'Enter': {
          event.preventDefault();

          // If showing assistant hint, enter assistant mode with query
          if (shouldShowAssistantHint) {
            enterAssistantMode(query);
            return;
          }

          const selected = filteredActions[selectedIndex];
          if (selected) {
            // Check if it's the "Talk to Athena" action
            if (selected.action.id === 'talk-to-athena') {
              enterAssistantMode();
              return;
            }

            if (selected.action.type === 'group') {
              pushNavigation(selected.action);
            } else {
              void executeAction(selected.action);
            }
          }
          break;
        }

        case 'Backspace':
          // If query is empty and we're in a group, go back
          if (query === '' && navigationStack.length > 0) {
            event.preventDefault();
            popNavigation();
          }
          break;

        case 'Escape':
          event.preventDefault();
          if (navigationStack.length > 0) {
            popNavigation();
          } else {
            close();
          }
          break;

        case 'Home':
          event.preventDefault();
          setSelectedIndex(0);
          break;

        case 'End':
          event.preventDefault();
          setSelectedIndex(filteredActions.length - 1);
          break;
      }
    },
    [
      mode,
      exitAssistantMode,
      activeAction,
      setActiveAction,
      selectedIndex,
      filteredActions,
      navigationStack,
      query,
      setSelectedIndex,
      pushNavigation,
      executeAction,
      popNavigation,
      close,
      shouldShowAssistantHint,
      enterAssistantMode,
    ],
  );

  const shortcutManager = getShortcutManager();
  const breadcrumbs = navigationStack.map((item) => item.action.label);
  const selectedAction = filteredActions[selectedIndex];

  // Announce results to screen readers
  const resultCount = filteredActions.length;
  const announcement = query
    ? `${String(resultCount)} result${resultCount !== 1 ? 's' : ''} found`
    : `${String(resultCount)} action${resultCount !== 1 ? 's' : ''} available`;
  const activeGroupLabel = navigationStack[navigationStack.length - 1]?.action.label;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          ref={contentRef}
          className={cn(
            'fixed top-[15%] left-1/2 z-50 w-full max-w-xl -translate-x-1/2',
            'bg-surface-container rounded-3xl shadow-2xl outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-200',
          )}
          onKeyDown={handleKeyDown}
          aria-labelledby={labelId}
          // Let Radix manage focus trap, but we focus input on open
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            // Prevent focus from jumping on close
            e.preventDefault();
          }}
        >
          {/* Accessible title (visually hidden) */}
          <VisuallyHidden asChild>
            <Dialog.Title id={labelId}>Command Palette</Dialog.Title>
          </VisuallyHidden>
          <VisuallyHidden asChild>
            <Dialog.Description>
              Search for commands and actions. Use arrow keys to navigate, Enter to select.
            </Dialog.Description>
          </VisuallyHidden>

          {/* Live region for screen reader announcements */}
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {announcement}
          </div>

          {/* Search Input - hide in assistant mode */}
          {mode !== 'assistant' && (
            <div className="bg-surface-container flex items-center gap-3 rounded-t-3xl px-4">
              <Search className="text-on-surface-variant h-5 w-5 shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                role="combobox"
                aria-expanded={!activeAction && filteredActions.length > 0}
                aria-controls={listboxId}
                aria-activedescendant={
                  selectedAction ? `palette-item-${selectedAction.action.id}` : undefined
                }
                aria-autocomplete="list"
                aria-haspopup="listbox"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                placeholder={
                  activeAction
                    ? activeAction.label
                    : activeGroupLabel
                      ? `Search in ${activeGroupLabel}...`
                      : 'Type a command or search...'
                }
                className={cn(
                  'text-on-surface flex-1 bg-transparent py-4 text-base outline-none',
                  'placeholder:text-on-surface-variant',
                )}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />

              {/* Clear button when there's text */}
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                  }}
                  className={cn(
                    'text-on-surface-variant rounded-full p-1',
                    'hover:bg-surface-container hover:text-on-surface',
                    'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
                    'duration-short3 transition-colors',
                  )}
                  aria-label="Clear search"
                  tabIndex={0}
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              <kbd
                className="bg-surface-container-highest text-on-surface-variant hidden rounded-md px-2 py-1 text-xs sm:inline-block"
                aria-hidden="true"
              >
                {shortcutManager.formatForDisplay('mod+k')}
              </kbd>
            </div>
          )}

          {/* Breadcrumb Navigation */}
          {mode !== 'assistant' && breadcrumbs.length > 0 && !activeAction && (
            <nav
              aria-label="Command palette navigation"
              className="bg-surface-container flex items-center gap-1 px-4 py-2"
            >
              <button
                type="button"
                onClick={clearNavigation}
                className={cn(
                  'text-on-surface-variant rounded px-1.5 py-0.5 text-xs',
                  'hover:bg-surface-container hover:text-on-surface',
                  'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
                  'duration-short3 transition-colors',
                )}
                tabIndex={0}
              >
                Commands
              </button>
              {breadcrumbs.map((crumb, index) => (
                <span key={index} className="flex items-center gap-1">
                  <ChevronRight className="text-outline h-3 w-3" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      const popsNeeded = breadcrumbs.length - index - 1;
                      for (let i = 0; i < popsNeeded; i++) {
                        popNavigation();
                      }
                    }}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-xs',
                      index === breadcrumbs.length - 1
                        ? 'text-on-surface font-medium'
                        : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                      'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
                      'duration-short3 transition-colors',
                    )}
                    aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}
                    tabIndex={0}
                  >
                    {crumb}
                  </button>
                </span>
              ))}
            </nav>
          )}

          {/* Content Area */}
          {mode === 'assistant' ? (
            // Assistant Mode
            <AssistantErrorBoundary variant="compact" onReset={exitAssistantMode}>
              <CommandPaletteAssistant
                initialMessage={assistantInitialMessage ?? undefined}
                onExit={exitAssistantMode}
                onExpand={() => {
                  close();
                  // Navigate to assistant modal (intercepted route)
                  router.push('/assistant');
                }}
              />
            </AssistantErrorBoundary>
          ) : activeAction ? (
            // Inline Form Mode
            <div className="palette-form-enter">
              <CommandPaletteForm />
            </div>
          ) : (
            // Action List Mode
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="Available commands"
              aria-activedescendant={
                selectedAction ? `palette-item-${selectedAction.action.id}` : undefined
              }
              className="max-h-[320px] overflow-y-auto overscroll-contain p-2"
              tabIndex={-1}
            >
              {shouldShowAssistantHint ? (
                // Show assistant hint when no results but query exists
                <div
                  className="flex flex-col items-center justify-center py-8 text-center"
                  role="status"
                >
                  <div className="bg-tertiary-container text-on-tertiary-container mb-3 rounded-full p-3">
                    <Search className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <p className="text-on-surface text-sm font-medium">No matching commands</p>
                  <p className="text-on-surface-variant mt-1 text-xs">
                    Press{' '}
                    <kbd className="bg-surface-container-highest rounded px-1 py-0.5 font-mono">
                      ↵
                    </kbd>{' '}
                    to ask Athena
                  </p>
                </div>
              ) : filteredActions.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center py-12 text-center"
                  role="status"
                >
                  <Search className="text-outline mb-3 h-8 w-8" aria-hidden="true" />
                  <p className="text-on-surface text-sm font-medium">No results found</p>
                  <p className="text-on-surface-variant mt-1 text-xs">
                    Try a different search term
                  </p>
                </div>
              ) : (
                filteredActions.map((match, index) => (
                  <CommandPaletteItem
                    key={match.action.id}
                    match={match}
                    isSelected={index === selectedIndex}
                    onSelect={() => {
                      setSelectedIndex(index);
                    }}
                    index={index}
                  />
                ))
              )}
            </div>
          )}

          {/* Footer - hide in assistant mode as it has its own footer */}
          {mode !== 'assistant' && (
            <footer className="bg-surface-container text-on-surface-variant flex items-center justify-between rounded-b-3xl px-4 py-2.5 text-xs">
              <div className="flex items-center gap-4" aria-hidden="true">
                <span className="flex items-center gap-1.5">
                  <kbd className="bg-surface-container-highest inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px]">
                    ↑↓
                  </kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="bg-surface-container-highest inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px]">
                    ↵
                  </kbd>
                  select
                </span>
                {(navigationStack.length > 0 || activeAction) && (
                  <span className="flex items-center gap-1.5">
                    <kbd className="bg-surface-container-highest inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px]">
                      {activeAction ? 'esc' : '⌫'}
                    </kbd>
                    back
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <kbd className="bg-surface-container-highest inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px]">
                    esc
                  </kbd>
                  close
                </span>
              </div>
              {isExecuting && (
                <span className="text-primary flex items-center gap-2">
                  <span
                    className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                    aria-hidden="true"
                  />
                  Running...
                </span>
              )}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
