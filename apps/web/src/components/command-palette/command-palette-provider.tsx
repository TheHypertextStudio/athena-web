'use client';

import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { CommandPalette } from './command-palette';
import { PageCommandsProvider } from './page-commands';
import type { PaletteOpening } from './subject-commands';

/** The command-palette controls exposed to the app shell. */
export interface CommandPaletteValue {
  /** Whether the palette overlay is currently open. */
  readonly open: boolean;
  /** Open the palette. */
  readonly openPalette: () => void;
  /** Close the palette. */
  readonly closePalette: () => void;
  /** Toggle the palette open/closed (the Cmd/Ctrl+K behavior). */
  readonly togglePalette: () => void;
}

/** Internal context; consumed only through {@link useCommandPalette}. */
const CommandPaletteContext = createContext<CommandPaletteValue | null>(null);

/** Props for the shell-persistent {@link CommandPaletteProvider}. */
export interface CommandPaletteProviderProps {
  /** Whether shortcuts and palette actions may run for the resolved authenticated context. */
  readonly enabled?: boolean;
  /** The persistent app-shell subtree. */
  readonly children: ReactNode;
}

/** Props for the shell-owned command palette overlay. */
export interface CommandPaletteHostProps {
  /** Whether the current route hosts the persistent utility rail. */
  readonly panelsAvailable: boolean;
  /** Ask the shell to reveal one of its persistent utility panels. */
  readonly onOpenPanel: (panelId: 'agenda' | 'focus' | 'athena') => void;
  /** Account id captured by the shell for destructive session commands. */
  readonly sessionOwnerUserId: string | null;
}

/**
 * Whether a keydown event is the palette's open shortcut (Cmd+K on macOS, Ctrl+K elsewhere).
 *
 * @remarks
 * Matches the metaKey (⌘) or ctrlKey modifier with the `k` key, so the binding works on both
 * platforms. Returns `false` for everything else.
 */
function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
}

/**
 * Provide the global command palette open state and Cmd/Ctrl+K listener.
 *
 * @remarks
 * Mounted once inside the `(app)` shell so the palette is available on every authenticated
 * page. It owns the open/closed state, installs a single document-level keydown listener that
 * toggles the palette on Cmd+K / Ctrl+K (preventing the browser default), locks body scroll
 * while open. Descendants drive it through {@link useCommandPalette}. The shell renders
 * {@link CommandPaletteHost} where panel commands can reach the rail controller.
 */
export function CommandPaletteProvider({
  enabled = true,
  children,
}: CommandPaletteProviderProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState<PaletteOpening | null>(null);
  // Read before the palette takes focus, so it still names the row or page the person was on.
  const recordOpening = useCallback(() => {
    setOpening({ element: document.activeElement });
  }, []);

  const openPalette = useCallback(() => {
    if (!enabled) return;
    recordOpening();
    setOpen(true);
  }, [enabled, recordOpening]);
  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);
  const togglePalette = useCallback(() => {
    if (!enabled) return;
    recordOpening();
    setOpen((o) => !o);
  }, [enabled, recordOpening]);

  // The global shortcut listener: Cmd/Ctrl+K toggles the palette. (Cmd/Ctrl+J summons the
  // Athena panel — see `AthenaPanelProvider`, which owns that shortcut independently.)
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      recordOpening();
      setOpen((o) => !o);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, recordOpening]);

  const visibleOpen = enabled && open;

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!visibleOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [visibleOpen]);

  const value = useMemo<CommandPaletteValue>(
    () => ({ open: visibleOpen, openPalette, closePalette, togglePalette }),
    [visibleOpen, openPalette, closePalette, togglePalette],
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      <PageCommandsProvider opening={opening}>{children}</PageCommandsProvider>
    </CommandPaletteContext.Provider>
  );
}

/** Render the palette overlay inside the shell that owns persistent utility panels. */
export function CommandPaletteHost({
  panelsAvailable,
  onOpenPanel,
  sessionOwnerUserId,
}: CommandPaletteHostProps): JSX.Element {
  const { open, closePalette } = useCommandPalette();

  return (
    <CommandPalette
      open={open}
      onClose={closePalette}
      panelsAvailable={panelsAvailable}
      onOpenPanel={onOpenPanel}
      sessionOwnerUserId={sessionOwnerUserId}
    />
  );
}

/**
 * Read the command-palette controls.
 *
 * @returns the current {@link CommandPaletteValue}.
 * @throws {Error} when called outside a {@link CommandPaletteProvider}.
 */
export function useCommandPalette(): CommandPaletteValue {
  const value = useContext(CommandPaletteContext);
  if (value === null) {
    throw new Error('useCommandPalette must be used within a <CommandPaletteProvider>.');
  }
  return value;
}
