'use client';

/**
 * `@docket/ui` — the desktop **panel host** for the shell's right-hand rail.
 *
 * @remarks
 * The right rail is a Sunsama-style pair: a thin, always-visible {@link ShellActivityBar} on the far
 * edge that switches which supplemental panel is active, plus this wider **panel host** beside it that
 * renders the active panel. The host is a single width-animated surface — expanded it is the full rail,
 * collapsed it animates to zero width — so the `flex-1` main panel reflows in one continuous motion.
 * The activity bar stays put and is the peek/reopen affordance, so the host needs no collapse chrome
 * of its own.
 *
 * Each panel owns its **own** header (the Agenda its day navigator, the Tasks panel its day + progress
 * header), so the host renders no title row — that avoids the double-header the old single-panel rail
 * had. Which panel is active, and the collapsed state, are shell-owned and passed in. This host is
 * present in the layout at **every** desktop width (`lg` and up) and hidden below it, where the same
 * panels are presented by the shell's modal right {@link Sheet}. The activity bar is deliberately
 * **internal-only** — a curated set of Docket-native panels, never a gallery of third-party add-ons.
 *
 * @remarks **The width law.** The rail's inline size is {@link RAIL_INLINE_SIZE} — a *share* of the
 * viewport, floored at 17.5rem and ceilinged at 22rem — never a fixed width that appears at a
 * breakpoint. Continuity is the whole fix for the shell's worst layout bug: a fixed 22rem rail that
 * docked at a threshold made `<main>` **narrower at a wider window** (measured: 1119px of main at
 * 1439px of viewport, 760px at 1440px). A width that is continuous, and whose slope stays under 1,
 * cannot do that — see the contract on {@link AppShell}. Concretely `<main>` = viewport − 328px of
 * fixed chrome − this rail.
 *
 * The floor is a deliberate departure from "a share and nothing else". A pure share bottoms out at
 * 174px on a 1024px window, which is narrower than the content it is meant to hold; the floor buys
 * the rail its legibility back and costs `<main>` its majority in the 1024–1279 band alone.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';

/** Stable id for the docked panel host, referenced by the activity bar's `aria-controls`. */
export const SHELL_ASIDE_ID = 'shell-aside';

/**
 * Stable id for the **modal sheet** presentation of the same panels, referenced by the mobile
 * trigger's `aria-controls`.
 *
 * @remarks
 * Distinct from {@link SHELL_ASIDE_ID} because the two are no longer mutually exclusive: the docked
 * host is now in the DOM at every width (CSS-hidden below `lg`), which is what keeps the desktop
 * chrome a constant width — so the sheet cannot borrow its id without duplicating one.
 */
export const SHELL_ASIDE_SHEET_ID = 'shell-aside-sheet';

/**
 * The rail's inline size as a CSS length: a viewport share, floored at 17.5rem and capped at 22rem.
 *
 * @remarks
 * Exported so the shell's layout contract is one number rather than a class string repeated in two
 * places, and so tests can assert against the same source the component renders from.
 *
 * **The floor is the point.** A share alone made the rail 174px at 1024px, and a 174px panel is not
 * a panel — every title in it truncated, and the Focus panel's own controls had to drop their
 * labels to fit. The share was never chosen for legibility: it was the largest number that still
 * left `<main>` a *majority* of a 1024px window, which is a rule about `<main>` being read as a
 * rule about the rail. 17.5rem (280px) is instead the narrowest the rail is worth docking at, and
 * `<main>`'s guarantee was lowered to match (see {@link AppShell.SHELL_MAIN_MIN_VIEWPORT_SHARE}) —
 * the two cannot both hold at 1024px, and a rail nobody can read is the worse thing to keep.
 *
 * `17vw` still governs the middle, so the rail only starts growing again past ~1647px, and the
 * `22rem` cap stops it on very wide displays and hands the surplus to `<main>`. Every regime has a
 * slope below 1, so `<main>` still gains from every pixel the window gains — the monotonicity
 * guarantee is untouched, and it is the one the original fixed-width rail actually broke.
 */
export const RAIL_INLINE_SIZE = 'clamp(17.5rem, 17vw, 22rem)';

/** The share of the viewport the rail takes between its floor and its cap. Mirrors {@link RAIL_INLINE_SIZE}. */
export const RAIL_VIEWPORT_SHARE = 0.17;

/** The rail's minimum inline size in px (the `17.5rem` floor in {@link RAIL_INLINE_SIZE}). */
export const RAIL_MIN_INLINE_SIZE_PX = 280;

/** The rail's maximum inline size in px (the `22rem` cap in {@link RAIL_INLINE_SIZE}). */
export const RAIL_MAX_INLINE_SIZE_PX = 352;

/** The Tailwind width utility for {@link RAIL_INLINE_SIZE}; kept literal so the scanner emits it. */
const RAIL_WIDTH_CLASS = 'w-[clamp(17.5rem,17vw,22rem)]';

/** How long the collapse/expand motion is armed for — matches the `--dur-slow` token (240ms). */
const RAIL_TOGGLE_DURATION_MS = 240;

/**
 * Live state a panel contributes to its own activity-bar icon.
 *
 * @remarks
 * The rail collapses to zero width, so a panel showing something ongoing — a running timer, work
 * waiting on the person — would otherwise vanish the moment they collapsed it. The icon is the one
 * part of the rail that is always on screen, which makes it the only honest place to say "this is
 * still happening" without a second, competing surface elsewhere in the shell.
 *
 * Kept to a tone and a sentence rather than an arbitrary node so the bar's fixed `w-12` cannot be
 * disturbed by whatever a panel decides to render, and so the state reaches a screen reader rather
 * than being a coloured dot only sighted people can act on.
 */
export interface RailPanelStatus {
  /** `active` is happening now, `muted` is held, `attention` is waiting on the person. */
  readonly tone: 'active' | 'muted' | 'attention';
  /** Appended to the icon's accessible name, e.g. `Tracking Deep work`. */
  readonly label: string;
}

/** One supplemental panel the rail can show: its content plus the activity-bar switcher metadata. */
export interface RailPanel {
  /** Stable id (also the persisted "active panel" key). */
  readonly id: string;
  /** Accessible name — the activity-bar button label + the host landmark label. */
  readonly label: string;
  /** The activity-bar glyph (and the mobile trigger icon when active). */
  readonly icon: React.ReactNode;
  /** The panel fills its host, and its named body is the only region allowed to scroll. */
  readonly node: React.ReactNode;
  /** Live state shown on the icon; absent when the panel has nothing ongoing to report. */
  readonly status?: RailPanelStatus;
}

/** The right rail: the ordered set of native panels plus the one shown by default. */
export interface AppShellAside {
  /** The curated, Docket-native panels (e.g. Tasks, Agenda) — never an integration add-on list. */
  readonly panels: readonly RailPanel[];
  /** Which panel is active until the user picks another (falls back to the first). */
  readonly defaultPanelId?: string;
}

/** Props for {@link ShellAside}. */
export interface ShellAsideProps {
  /** The currently active panel to render. */
  readonly panel: RailPanel;
  /** Whether the host is collapsed to zero width (the activity bar stays visible). */
  readonly collapsed: boolean;
}

/**
 * The desktop panel host: a width-animated surface rendering the active panel; the bar handles toggling.
 *
 * @remarks
 * Hidden below `lg` **in CSS, not in JS**, and rendered by {@link AppShell} at every desktop width.
 * Both details are load-bearing for the layout contract: a CSS-only presence means the first paint is
 * already the final layout (no hydration reflow), and being present at every desktop width — even
 * collapsed, at zero width — keeps the shell's fixed chrome the *same* 328px at 1024px as at 1920px.
 * When the host was conditionally mounted, its flex gap alone made `<main>` 7px narrower at 1440 than
 * at 1439.
 *
 * The panel body sees a `@container` context, so a panel lays itself out against the rail's real
 * inline size (which is a share of the viewport, not a constant) rather than a viewport breakpoint.
 */
export function ShellAside({ panel, collapsed }: ShellAsideProps): React.JSX.Element {
  const open = !collapsed;

  // The width transition is armed ONLY for the collapse/expand toggle, never for a resize. The rail's
  // width is a share of the viewport, so a permanently-armed `transition-[width]` would also animate
  // every pixel of a window drag — the rail (and therefore `<main>`, its flex sibling) would rubber-
  // band 240ms behind the window edge the whole time it moved. Derived during render, not in an
  // effect, so the class is present on the very render that changes the width; cleared once the
  // motion is over.
  const previousCollapsed = React.useRef(collapsed);
  const [animating, setAnimating] = React.useState(false);
  if (previousCollapsed.current !== collapsed) {
    previousCollapsed.current = collapsed;
    if (!animating) setAnimating(true);
  }
  React.useEffect(() => {
    if (!animating) return undefined;
    const timer = setTimeout(() => {
      setAnimating(false);
    }, RAIL_TOGGLE_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [animating]);

  return (
    <aside
      id={SHELL_ASIDE_ID}
      aria-label={panel.label}
      inert={open ? undefined : true}
      className={cn(
        // Tonal surface (no border and no shadow — the surface step off the canvas carries the
        // separation, and a second shadowed box beside `<main>` framed the content twice); width is
        // the only animated property, and it's a flex sibling of `<main>`, so the panel reflows in one
        // continuous motion. Collapsed → zero width; the always-visible activity bar is the reopen.
        'bg-surface @container hidden h-full min-h-0 shrink-0 overflow-hidden rounded-xl lg:block',
        animating && 'transition-[width] duration-(--dur-slow) ease-in-out',
        open ? RAIL_WIDTH_CLASS : 'w-0',
      )}
    >
      {/* Inner pinned to the expanded width so the content never reflows while the wrapper animates
          its width — it slides out of view instead of relaying out on every frame. */}
      <div className={cn('h-full min-h-0 overflow-hidden', RAIL_WIDTH_CLASS)}>{panel.node}</div>
    </aside>
  );
}
