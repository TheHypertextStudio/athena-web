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

import { usePathname, useRouter } from 'next/navigation';

import { CommandPalette } from './command-palette';

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
 * Whether a keydown event is the Athena shortcut (Cmd+J / Ctrl+J) — summon the org's
 * chat thread from anywhere in the workspace.
 */
function isAthenaShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'j';
}

/**
 * Provide the global command palette: open state, the Cmd/Ctrl+K listener, and the overlay.
 *
 * @remarks
 * Mounted once inside the `(app)` shell so the palette is available on every authenticated
 * page. It owns the open/closed state, installs a single document-level keydown listener that
 * toggles the palette on Cmd+K / Ctrl+K (preventing the browser default), locks body scroll
 * while open, and renders the {@link CommandPalette} overlay. Descendants — including the
 * shell's rail Search entry and the visible trigger — drive it through {@link useCommandPalette}.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);
  const togglePalette = useCallback(() => {
    setOpen((o) => !o);
  }, []);

  const router = useRouter();
  const pathname = usePathname();

  // The global shortcut listener: Cmd/Ctrl+K toggles the palette; Cmd/Ctrl+J summons
  // Athena — the org's ONE persistent chat thread — from anywhere in that org's pages.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (isAthenaShortcut(event)) {
        const match = /^\/orgs\/([^/]+)(?:\/|$)/.exec(pathname);
        if (!match?.[1]) return;
        event.preventDefault();
        setOpen(false);
        router.push(`/orgs/${match[1]}/athena`);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [router, pathname]);

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const value = useMemo<CommandPaletteValue>(
    () => ({ open, openPalette, closePalette, togglePalette }),
    [open, openPalette, closePalette, togglePalette],
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onClose={closePalette} />
    </CommandPaletteContext.Provider>
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
