'use client';

/**
 * `settings` — the settings modal's responsive pane: a rail beside the content from `sm` up, one
 * view at a time below it.
 *
 * @remarks
 * The rail is a fixed `w-52`. Beside the shell's `gap-8` and `p-5` that costs 280px, so on a 390px
 * phone the content pane was left roughly 110px: headings clipped mid-word, `Add domain` off-screen,
 * body copy wrapped to one word per line — on every settings section, since the rail belongs to the
 * shell (`docs/design/audits/2026-08-14-publishing-addresses.md`, finding 1).
 *
 * Below `sm` the pane therefore shows **either** the section list **or** a section, the way a phone's
 * own Settings does: the list fills the pane, choosing from it replaces the list with that section,
 * and a control above the content goes back. A menu was tried first and was the wrong shape — 19
 * sections in a floating overlay is a navigation tree wearing a short-choice-list's clothes, it
 * scrolls past the viewport, and it hides the four-group structure the rail makes legible at a
 * glance.
 *
 * **One nav, not two.** The same element is the phone's root list and the desktop's rail; only its
 * box changes across the breakpoint. Rendering a second, phone-only copy of the list is what would
 * let the two drift, and the finding being closed here was a section you could not reach — so a
 * second derivation of "which sections exist" is the one thing this must not grow.
 *
 * The URL still names the section on its own; `browsing` is local view state, so going back to the
 * list is not a navigation and leaves no history entry to trip over.
 */
import { cn } from '@docket/ui';
import { ChevronLeft } from '@docket/ui/icons';
import { Surface, focusRing } from '@docket/ui/primitives';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';

/** Props for {@link SettingsPane}. */
export interface SettingsPaneProps {
  /**
   * Render the section list. Receives the callback to call once a section has been chosen, so the
   * phone leaves the list for the section the choice just routed to.
   */
  readonly renderNav: (onNavigate: () => void) => ReactNode;
  /** The routed section's content. */
  readonly children: ReactNode;
}

/** The settings modal's pane. See the module remarks for the two-level phone behaviour. */
export function SettingsPane({ renderNav, children }: SettingsPaneProps): JSX.Element {
  // Opens on the section, not the list: the URL already names one, and landing on a list the
  // viewer did not ask for would make every deep link cost an extra tap.
  const [browsing, setBrowsing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Open the list where the viewer already is. There are 19 sections and the current one is often
  // well below the fold — `Publishing` is last — so a list that always starts at the top makes you
  // hunt for the row you just came from, which is the moment a back control is supposed to save.
  useEffect(() => {
    if (!browsing) return;
    const current = listRef.current?.querySelector('[aria-current="page"]');
    if (current instanceof HTMLElement) current.scrollIntoView({ block: 'center' });
  }, [browsing]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:gap-8">
      <div
        ref={listRef}
        className={cn(
          'overflow-y-auto sm:block sm:w-52 sm:flex-none',
          // Below `sm` the list is the whole pane while browsing, and absent otherwise; from `sm`
          // up the same element is always the rail.
          browsing ? 'min-w-0 flex-1' : 'hidden',
        )}
      >
        {renderNav(() => {
          setBrowsing(false);
        })}
      </div>

      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col gap-3 sm:flex',
          browsing ? 'hidden' : '',
        )}
      >
        {/* Rendered only while a section is showing: with the list already up there is nothing to
            go back to, and a control that points at the view you are on is worse than no control. */}
        {browsing ? null : (
          <button
            type="button"
            onClick={() => {
              setBrowsing(true);
            }}
            className={cn(
              // The button sits on the modal panel itself (`surface-container-high`), so its hover
              // steps to `highest`. Hovering to `high` — what this used to do — was a no-op.
              'text-on-surface-variant text-label-large hover:bg-surface-container-highest hover:text-on-surface -ml-2 inline-flex min-h-11 shrink-0 items-center gap-1 self-start rounded-md pr-3 pl-1 transition-colors sm:hidden',
              focusRing,
            )}
          >
            <ChevronLeft aria-hidden="true" className="size-5 shrink-0" />
            All settings
          </button>
        )}
        {/* The content pane is the one region lowered off the panel. The modal panel is
            `surface-container-high`; a group drawn on it at `surface-container-low` sat *below* its
            own background, which is why 88 hairlines had been added to make those cards visible.
            Dropping the pane to `surface` puts every group one step above it, so the ramp runs the
            way `docs/design/design-system.md` §8 describes and the lines are simply gone. */}
        <Surface tone="page" shape="medium" pad="roomy" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </Surface>
      </div>
    </div>
  );
}
