'use client';

/**
 * `@docket/ui` — the rail's panels as one full-window sheet below `lg`.
 *
 * @remarks
 * Split out of {@link AppShell}. Material's adaptive supporting-pane model shows only the current
 * pane at compact and medium widths, so no strip of the unusable page remains visible underneath.
 * Mounted open only when the desktop query does *not* match, so Radix's focus trap and scroll-lock
 * never activate over a docked rail; it carries its own id ({@link SHELL_ASIDE_SHEET_ID}) because
 * the docked host is in the DOM at every width and the two cannot share one. A single active-panel
 * menu replaces the desktop activity bar. The explicit close action, Escape, and browser dismissal
 * all return to the invoking page.
 *
 * The title bar ends in a slot ({@link RailSheetBarSlotProvider}) a panel can portal its own header
 * controls into, so the sheet paints one header row, never the bar plus a second row of the
 * panel's own.
 */
import * as React from 'react';

import { X } from '../../icons';
import { cn } from '../../lib/utils';
import { focusRing } from '../../primitives/focus';
import { Sheet, SheetBody, SheetClose, SheetContent, SheetTitle } from '../../primitives';
import { MobilePanelSwitcher } from './MobilePanelSwitcher';
import { RailPresentationProvider, RailSheetBarSlotProvider } from './RailPresentationContext';
import { SHELL_ASIDE_SHEET_ID, type RailPanel } from './ShellAside';

/** Props for {@link ShellUtilitySheet}. */
export interface ShellUtilitySheetProps {
  /** Every panel the rail offers, for the switcher. */
  readonly panels: readonly RailPanel[];
  /** The panel the sheet shows, or `null` when the rail has none. */
  readonly activePanel: RailPanel | null;
  /** Whether the sheet is open. */
  readonly open: boolean;
  /** Whether the desktop query matches; the title bar is only drawn below it. */
  readonly isDesktop: boolean;
  /** Close the sheet. */
  readonly onClose: () => void;
  /** Switch the active panel. */
  readonly onSelectPanel: (panelId: string) => void;
}

/** The mobile utility sheet: a title bar with the switcher, a slot, and close; then the panel. */
export function ShellUtilitySheet({
  panels,
  activePanel,
  open,
  isDesktop,
  onClose,
  onSelectPanel,
}: ShellUtilitySheetProps): React.JSX.Element {
  const [barSlot, setBarSlot] = React.useState<HTMLDivElement | null>(null);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        presentation="fullscreen"
        id={SHELL_ASIDE_SHEET_ID}
        aria-label={activePanel?.label}
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">{activePanel?.label}</SheetTitle>
        {!isDesktop && activePanel ? (
          <div
            data-testid="shell-utility-pane-bar"
            className="flex min-h-12 shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]"
          >
            <div className="min-w-0 shrink-0">
              <MobilePanelSwitcher
                panels={panels}
                activePanel={activePanel}
                onSelect={onSelectPanel}
              />
            </div>
            <div
              ref={setBarSlot}
              data-slot="shell-utility-pane-bar-slot"
              className="flex min-w-0 flex-1 items-center justify-end gap-1"
            />
            <SheetClose asChild>
              <button
                type="button"
                aria-label={`Close ${activePanel.label}`}
                className={cn(
                  'text-on-surface-variant hover:bg-surface-container-high flex size-10 shrink-0 items-center justify-center rounded-full transition-colors',
                  focusRing,
                )}
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </SheetClose>
          </div>
        ) : null}
        <SheetBody
          inset="none"
          scroll="visible"
          data-slot="shell-utility-pane-body"
          className="@container"
        >
          <RailPresentationProvider value="sheet">
            <RailSheetBarSlotProvider slot={barSlot}>{activePanel?.node}</RailSheetBarSlotProvider>
          </RailPresentationProvider>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
