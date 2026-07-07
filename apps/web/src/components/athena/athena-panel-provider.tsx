'use client';

/**
 * The global ⌘J slide-over onto Athena's persistent chat thread.
 *
 * @remarks
 * Athena is meant to be summonable from anywhere without leaving the page you're on — this is
 * that door. It renders the SAME {@link AthenaConversation} the standalone `/orgs/:orgId/athena`
 * page shows (one thread, many doors: never a second, ephemeral conversation). The panel needs
 * the shell's already-resolved active org (route ?? last-used ?? personal space — see
 * `AppShellInner`), so it's mounted there and takes `orgId` as a prop rather than re-deriving it.
 */
import { Sparkles, X } from '@docket/ui/icons';
import { Button, Sheet, SheetClose, SheetContent, SheetTitle } from '@docket/ui/primitives';
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

import AthenaConversation from './athena-conversation';

/** Whether a keydown event is the Athena shortcut (Cmd+J / Ctrl+J) — summon the org's chat thread. */
function isAthenaShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'j';
}

/** The Athena panel controls exposed to the app shell. */
export interface AthenaPanelValue {
  /** Whether the panel is currently open. */
  readonly open: boolean;
  /** Open the panel (a no-op with no resolved org, e.g. on the cross-org Hub). */
  readonly openPanel: () => void;
  /** Close the panel. */
  readonly closePanel: () => void;
}

/** Internal context; consumed only through {@link useAthenaPanel}. */
const AthenaPanelContext = createContext<AthenaPanelValue | null>(null);

/** Props for {@link AthenaPanelProvider}. */
export interface AthenaPanelProviderProps {
  /** The shell's resolved active org, or `null` when none is bound (the Hub). */
  orgId: string | null;
  children: ReactNode;
}

/** Provide the global Athena panel: open state and the slide-over onto the org's chat thread. */
export function AthenaPanelProvider({ orgId, children }: AthenaPanelProviderProps): JSX.Element {
  const [open, setOpen] = useState(false);

  const openPanel = useCallback(() => {
    if (orgId) setOpen(true);
  }, [orgId]);
  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  // ⌘J / Ctrl+J toggles the panel from anywhere — a no-op with no resolved org (the cross-org
  // Hub), same guard as `openPanel`.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isAthenaShortcut(event) || !orgId) return;
      event.preventDefault();
      setOpen((o) => !o);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [orgId]);

  const value = useMemo<AthenaPanelValue>(
    () => ({ open, openPanel, closePanel }),
    [open, openPanel, closePanel],
  );

  return (
    <AthenaPanelContext.Provider value={value}>
      {children}
      {orgId ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="right"
            aria-describedby={undefined}
            className="@container flex w-[26rem] max-w-[90vw] flex-col p-0"
          >
            <div className="border-outline-variant flex h-11 shrink-0 items-center justify-between border-b pr-2 pl-4">
              <SheetTitle asChild>
                <span className="flex items-center gap-1.5">
                  <Sparkles aria-hidden="true" className="text-primary size-4" />
                  Athena
                </span>
              </SheetTitle>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" aria-label="Close" className="size-10">
                  <X aria-hidden="true" className="size-4" />
                </Button>
              </SheetClose>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-4">
              <AthenaConversation orgId={orgId} className="h-full" />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </AthenaPanelContext.Provider>
  );
}

/**
 * Read the Athena panel controls.
 *
 * @returns the current {@link AthenaPanelValue}.
 * @throws {Error} when called outside an {@link AthenaPanelProvider}.
 */
export function useAthenaPanel(): AthenaPanelValue {
  const value = useContext(AthenaPanelContext);
  if (value === null) {
    throw new Error('useAthenaPanel must be used within an <AthenaPanelProvider>.');
  }
  return value;
}
