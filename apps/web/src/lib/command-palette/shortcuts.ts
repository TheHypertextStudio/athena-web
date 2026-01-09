/**
 * Keyboard shortcut manager for command palette.
 *
 * This module provides a centralized system for managing keyboard shortcuts
 * across the application. It's used by the command palette to:
 *
 * 1. Register global shortcuts that work anywhere in the app (e.g., Cmd+K to open palette)
 * 2. Register action-specific shortcuts (e.g., 'c t' to create a task)
 * 3. Display formatted shortcut hints in the UI (e.g., showing "⌘K" on Mac vs "Ctrl+K" on Windows)
 *
 * ## Key Concepts
 *
 * ### Modifier Keys
 * - `mod` - Platform-aware: resolves to Cmd on Mac, Ctrl on Windows/Linux
 * - `ctrl`, `alt`, `shift`, `meta` - Explicit modifier keys
 *
 * ### Key Sequences (Vim-style)
 * Shortcuts can be sequences of keys separated by spaces:
 * - `'g t'` - Press 'g', then 't' within 1 second
 * - `'mod+k'` - Hold Cmd/Ctrl and press K
 *
 * ### Scopes
 * - `global` - Works anywhere in the app
 * - `palette` - Only works when command palette is open
 * - `editor` - Only works in editor contexts
 *
 * ## Usage
 *
 * ```typescript
 * const manager = getShortcutManager();
 *
 * // Register a shortcut
 * const unregister = manager.register(
 *   { id: 'open-palette', keys: 'mod+k', scope: 'global' },
 *   () => openCommandPalette()
 * );
 *
 * // Format for display in UI
 * manager.formatForDisplay('mod+k'); // "⌘K" on Mac, "Ctrl+K" on Windows
 *
 * // Clean up when component unmounts
 * unregister();
 * ```
 *
 * @packageDocumentation
 */

import type { KeyboardShortcut, ShortcutManager, ShortcutScope } from './types';

/** Check if running on macOS. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Map of registered shortcuts to their handlers. */
interface ShortcutEntry {
  shortcut: KeyboardShortcut;
  handler: () => void;
}

/** Pending sequence state for vim-style shortcuts. */
interface SequenceState {
  keys: string[];
  timeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Parse a key combination string into its constituent parts.
 *
 * A key combination is a string like 'mod+k' or 'ctrl+shift+p' where:
 * - Parts before the last '+' are modifier keys (mod, ctrl, alt, shift, meta)
 * - The last part is the actual key to press
 *
 * This function splits the combination and returns the modifiers as a Set
 * for easy lookup, plus the final key.
 *
 * @param combo - Key combination string (e.g., 'mod+k', 'ctrl+shift+p')
 * @returns Object with modifiers Set and the key string
 *
 * @example
 * parseKeyCombination('mod+k')
 * // Returns: { modifiers: Set(['mod']), key: 'k' }
 *
 * @example
 * parseKeyCombination('ctrl+shift+p')
 * // Returns: { modifiers: Set(['ctrl', 'shift']), key: 'p' }
 *
 * @example
 * parseKeyCombination('escape')
 * // Returns: { modifiers: Set([]), key: 'escape' }
 */
function parseKeyCombination(combo: string): {
  modifiers: Set<string>;
  key: string;
} {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const modifiers = new Set(parts);
  return { modifiers, key };
}

/**
 * Check if a keyboard event matches a specified key combination.
 *
 * This is the core matching logic that compares a KeyboardEvent against
 * a key combination string. It handles:
 * - The 'mod' pseudo-modifier (Cmd on Mac, Ctrl on Windows/Linux)
 * - All standard modifiers (ctrl, alt, shift, meta)
 * - Ensuring no extra modifiers are pressed
 *
 * @param event - The keyboard event from the browser
 * @param combo - Key combination to match (e.g., 'mod+k', 'shift+enter')
 * @returns true if the event matches the combination exactly
 *
 * @example
 * // User presses Cmd+K on Mac
 * matchesKeyCombination(event, 'mod+k') // true
 *
 * @example
 * // User presses Cmd+Shift+K but we only want Cmd+K
 * matchesKeyCombination(event, 'mod+k') // false (extra modifier)
 */
function matchesKeyCombination(event: KeyboardEvent, combo: string): boolean {
  const { modifiers, key } = parseKeyCombination(combo);

  // Check the key
  if (event.key.toLowerCase() !== key) {
    return false;
  }

  // Check modifiers
  const hasCtrl = event.ctrlKey;
  const hasMeta = event.metaKey;
  const hasAlt = event.altKey;
  const hasShift = event.shiftKey;

  // 'mod' means Cmd on Mac, Ctrl elsewhere
  const needsMod = modifiers.has('mod');
  const needsCtrl = modifiers.has('ctrl');
  const needsMeta = modifiers.has('meta');
  const needsAlt = modifiers.has('alt');
  const needsShift = modifiers.has('shift');

  // Check mod key
  if (needsMod) {
    if (isMac && !hasMeta) return false;
    if (!isMac && !hasCtrl) return false;
  }

  // Check specific modifiers
  if (needsCtrl && !hasCtrl) return false;
  if (needsMeta && !hasMeta) return false;
  if (needsAlt && !hasAlt) return false;
  if (needsShift && !hasShift) return false;

  // Make sure we don't have extra modifiers
  const expectedModCount =
    (needsMod ? 1 : 0) +
    (needsCtrl ? 1 : 0) +
    (needsMeta ? 1 : 0) +
    (needsAlt ? 1 : 0) +
    (needsShift ? 1 : 0);

  const actualModCount =
    (hasCtrl ? 1 : 0) + (hasMeta ? 1 : 0) + (hasAlt ? 1 : 0) + (hasShift ? 1 : 0);

  // Account for 'mod' overlapping with ctrl/meta
  const modOverlap = needsMod ? 1 : 0;

  return (
    actualModCount ===
    expectedModCount - modOverlap + (needsMod && (isMac ? hasMeta : hasCtrl) ? 1 : 0)
  );
}

/**
 * Check if focus is in an input-like element.
 */
function isInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;

  const tagName = active.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') {
    return true;
  }

  // Check for contenteditable
  if (active.getAttribute('contenteditable') === 'true') {
    return true;
  }

  return false;
}

/**
 * Format a key combination for display.
 */
function formatKeyForDisplay(key: string): string {
  const keyMap: Record<string, string> = {
    mod: isMac ? '⌘' : 'Ctrl',
    ctrl: isMac ? '⌃' : 'Ctrl',
    alt: isMac ? '⌥' : 'Alt',
    shift: isMac ? '⇧' : 'Shift',
    meta: isMac ? '⌘' : 'Win',
    enter: '↵',
    escape: 'Esc',
    backspace: '⌫',
    delete: 'Del',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    tab: '⇥',
    space: '␣',
  };

  const lower = key.toLowerCase();
  return keyMap[lower] ?? key.toUpperCase();
}

/**
 * Create a new shortcut manager instance.
 *
 * The shortcut manager is the central coordinator for all keyboard shortcuts.
 * It maintains a registry of shortcuts and their handlers, listens for keyboard
 * events, and dispatches to the appropriate handler when a shortcut is triggered.
 *
 * ## Key Features
 *
 * - **Scope Management**: Shortcuts can be scoped to 'global', 'palette', or 'editor'.
 *   Use `setScope()` to change which shortcuts are active.
 *
 * - **Sequence Support**: Vim-style shortcuts like 'g t' (press g, then t) are supported.
 *   Sequences timeout after 1 second if not completed.
 *
 * - **Input Awareness**: By default, shortcuts don't fire when focus is in an input.
 *   Set `allowInInput: true` on a shortcut to override.
 *
 * - **Conflict Detection**: Use `getConflicts()` to check for duplicate key bindings.
 *
 * ## Lifecycle
 *
 * 1. Create the manager: `const manager = createShortcutManager()`
 * 2. Attach to window: `window.addEventListener('keydown', manager.handleKeyDown)`
 * 3. Register shortcuts: `manager.register(shortcut, handler)`
 * 4. Clean up: `manager.destroy()` and remove event listener
 *
 * @returns ShortcutManager instance with additional internal methods
 */
export function createShortcutManager(): ShortcutManager & {
  handleKeyDown: (event: KeyboardEvent) => void;
  setScope: (scope: ShortcutScope) => void;
  destroy: () => void;
} {
  const shortcuts = new Map<string, ShortcutEntry>();
  let currentScope: ShortcutScope = 'global';
  let sequenceState: SequenceState = { keys: [], timeout: null };
  const SEQUENCE_TIMEOUT = 1000; // 1 second to complete sequence

  function clearSequence(): void {
    if (sequenceState.timeout) {
      clearTimeout(sequenceState.timeout);
    }
    sequenceState = { keys: [], timeout: null };
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // Build the current key string
    const key = event.key.toLowerCase();

    // Skip modifier-only presses
    if (['control', 'alt', 'shift', 'meta'].includes(key)) {
      return;
    }

    // Check for modifier combinations first (single-press shortcuts)
    for (const entry of shortcuts.values()) {
      const { shortcut, handler } = entry;

      // Check scope
      if (shortcut.scope !== 'global' && shortcut.scope !== currentScope) {
        continue;
      }

      // Check input focus
      if (!shortcut.allowInInput && isInputFocused()) {
        continue;
      }

      const keys = shortcut.keys;

      // Check if this is a sequence (contains space)
      if (keys.includes(' ')) {
        // Handle as sequence
        const parts = keys.split(' ');

        // Add current key to sequence if it matches
        if (sequenceState.keys.length === 0) {
          // Starting a new sequence
          if (matchesKeyCombination(event, parts[0] ?? '')) {
            if (shortcut.preventDefault !== false) {
              event.preventDefault();
            }
            sequenceState.keys.push(parts[0] ?? '');
            sequenceState.timeout = setTimeout(clearSequence, SEQUENCE_TIMEOUT);
            return;
          }
        } else {
          // Continuing a sequence
          const expectedIndex = sequenceState.keys.length;
          const expectedKey = parts[expectedIndex];

          if (expectedKey && matchesKeyCombination(event, expectedKey)) {
            if (shortcut.preventDefault !== false) {
              event.preventDefault();
            }
            sequenceState.keys.push(expectedKey);

            // Check if sequence is complete
            if (sequenceState.keys.length === parts.length) {
              clearSequence();
              handler();
              return;
            }

            // Reset timeout
            if (sequenceState.timeout) {
              clearTimeout(sequenceState.timeout);
            }
            sequenceState.timeout = setTimeout(clearSequence, SEQUENCE_TIMEOUT);
            return;
          }
        }
      } else {
        // Single key combination
        if (matchesKeyCombination(event, keys)) {
          if (shortcut.preventDefault !== false) {
            event.preventDefault();
          }
          clearSequence();
          handler();
          return;
        }
      }
    }

    // If we get here and have a pending sequence, check if this key breaks it
    if (sequenceState.keys.length > 0) {
      // Key didn't match any sequence continuation, reset
      clearSequence();
    }
  }

  return {
    register(shortcut: KeyboardShortcut, handler: () => void): () => void {
      shortcuts.set(shortcut.id, { shortcut, handler });
      return () => shortcuts.delete(shortcut.id);
    },

    unregister(id: string): void {
      shortcuts.delete(id);
    },

    getConflicts(keys: string): KeyboardShortcut[] {
      const conflicts: KeyboardShortcut[] = [];
      for (const [, entry] of shortcuts) {
        if (entry.shortcut.keys === keys) {
          conflicts.push(entry.shortcut);
        }
      }
      return conflicts;
    },

    formatForDisplay(keys: string): string {
      // Handle sequences
      if (keys.includes(' ')) {
        return keys
          .split(' ')
          .map((combo) =>
            combo
              .split('+')
              .map(formatKeyForDisplay)
              .join(isMac ? '' : '+'),
          )
          .join(' ');
      }

      // Single combination
      return keys
        .split('+')
        .map(formatKeyForDisplay)
        .join(isMac ? '' : '+');
    },

    isActive(id: string): boolean {
      return shortcuts.has(id);
    },

    handleKeyDown,

    setScope(scope: ShortcutScope): void {
      currentScope = scope;
    },

    destroy(): void {
      shortcuts.clear();
      clearSequence();
    },
  };
}

/** Singleton shortcut manager instance. */
let shortcutManagerInstance: ReturnType<typeof createShortcutManager> | null = null;

/**
 * Get the global shortcut manager instance.
 */
export function getShortcutManager(): ReturnType<typeof createShortcutManager> {
  shortcutManagerInstance ??= createShortcutManager();
  return shortcutManagerInstance;
}
