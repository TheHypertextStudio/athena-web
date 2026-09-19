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
 * @remarks **The width law.** The rail's inline size is a *person-chosen* pixel width, never a
 * function of the viewport: {@link RAIL_DEFAULT_INLINE_SIZE_PX} (420px) until the viewer drags or
 * keyboard-resizes the handle on its inner edge, and whatever they set it to after that. Both are
 * plain constants rather than a share of the window, which is what replaced the previous
 * `clamp(17.5rem, 17vw, 22rem)` viewport-share expression — that clamp existed only to keep
 * `<main>` from narrowing as the window widened, and a *fixed* rail width satisfies that same
 * guarantee more directly: since the rail contributes zero marginal width per pixel of window
 * growth, `<main>` gains every one of those pixels, one-for-one, with no slope arithmetic needed
 * to prove it. See the contract on {@link AppShell}.
 *
 * A fixed default is also legible at every desktop width, unlike the old share's 174px floor at
 * 1024px — the floor here is {@link RAIL_MIN_INLINE_SIZE_PX} (360px), a number the resize handle
 * enforces rather than one a narrow window could shrink the rail to on its own.
 *
 * **The only ceiling is the window itself.** Dragging or keyboard-resizing the rail's inner edge
 * (the {@link ShellAsideProps.onWidthChange} handle below) hands the shell a new pixel width, up to
 * half the window's current inline size ({@link railResizeMaxPx}) and down to
 * {@link RAIL_MIN_INLINE_SIZE_PX}. {@link AppShell} persists the result under the
 * `docket.rail.width` rail state key (`RAIL_WIDTH_KEY` in `./rail-requests`) and feeds it back in
 * as {@link ShellAsideProps.width} on every render after that, in place of the default, until the
 * viewer resizes again.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { surfaceToneColor } from '../../primitives';

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
 * The rail's inline size, in px, until the viewer chooses their own: a plain constant, not a
 * function of the viewport.
 *
 * @remarks
 * Exported so the shell's layout contract reads from the same number the component renders from,
 * rather than a class string repeated in two places. 420px is comfortably above
 * {@link RAIL_MIN_INLINE_SIZE_PX} and well under half of any desktop-width window
 * ({@link railResizeMaxPx}), so it never needs clamping in practice — {@link railClampWidthPx}
 * still guards the arithmetic for a hypothetically narrow one.
 */
export const RAIL_DEFAULT_INLINE_SIZE_PX = 420;

/** {@link RAIL_DEFAULT_INLINE_SIZE_PX} as the CSS length {@link ShellAside} paints an unstored rail with. */
export const RAIL_INLINE_SIZE = `${String(RAIL_DEFAULT_INLINE_SIZE_PX)}px`;

/**
 * The rail's minimum inline size in px — the floor both the default and every resize obey.
 *
 * @remarks
 * A hard number a person can always read a panel at, rather than a share of the window that could
 * shrink below it. Every desktop viewport (1024px and up) leaves half its width comfortably above
 * this floor, so the two bounds {@link railResizeMaxPx} enforces never invert.
 */
export const RAIL_MIN_INLINE_SIZE_PX = 360;

/**
 * A generous upper-bound guess for how wide a person would ever resize the rail to, used only to
 * seed {@link useWindowInlineSize}'s SSR fallback viewport size.
 *
 * @remarks
 * Not an enforced ceiling — the real one is dynamic: half the window's own inline size, via
 * {@link railResizeMaxPx}. This constant only needs to be safely larger than any width a person
 * could actually reach, so the fallback viewport it derives never makes an SSR-rendered handle
 * look clamped when the client's first measurement lands.
 */
export const RAIL_MAX_INLINE_SIZE_PX = 640;

/**
 * The gap between an open rail and the activity bar, in px. It belongs to the rail: a collapsed
 * rail has no width and no gap, so the bar sits one shell gutter from `<main>` and hugs its icons.
 */
export const RAIL_GAP_PX = 8;

/** How far one Left/Right arrow press moves the rail's resize handle, in px. */
export const RAIL_RESIZE_STEP_PX = 16;

/**
 * The largest inline size a person may drag or keyboard-resize the rail to: half the window's
 * inline size.
 *
 * @remarks
 * Only meaningful at `lg` and up, where the docked rail is the one thing this handle resizes — at
 * every width it renders at, half the viewport is comfortably above {@link RAIL_MIN_INLINE_SIZE_PX},
 * so the two bounds never invert.
 *
 * @param viewportInlineSizePx - The window's current inline size, in px.
 * @returns half of `viewportInlineSizePx`, rounded to the nearest px.
 */
export function railResizeMaxPx(viewportInlineSizePx: number): number {
  return Math.max(Math.round(viewportInlineSizePx / 2), RAIL_MIN_INLINE_SIZE_PX);
}

/**
 * The rail's inline size in px when no person-chosen width is stored: {@link RAIL_DEFAULT_INLINE_SIZE_PX},
 * clamped down only if the window is too narrow to fit it at all.
 *
 * @remarks
 * Named for what it does, not just the default it falls back to: {@link AppShell}'s width
 * arithmetic (`shellMainInlineSize`) calls this directly to know what the *unstored* rail costs
 * `<main>` at a given viewport, since that is the one width every fresh session actually renders.
 *
 * @param viewportInlineSizePx - The window's current inline size, in px.
 * @returns {@link RAIL_DEFAULT_INLINE_SIZE_PX}, or {@link railResizeMaxPx} of the viewport when that
 * is smaller.
 */
export function railClampWidthPx(viewportInlineSizePx: number): number {
  return Math.min(RAIL_DEFAULT_INLINE_SIZE_PX, railResizeMaxPx(viewportInlineSizePx));
}

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
 * Kept to a tone and a sentence rather than an arbitrary node so the bar's fixed `w-10` cannot be
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
  /**
   * The viewer's own resized width in px, read from storage by {@link AppShell}. `undefined` keeps
   * {@link RAIL_INLINE_SIZE}'s viewport-share clamp — see the width law above.
   */
  readonly width?: number | undefined;
  /**
   * Report a new width from the resize handle on the rail's inner edge — a drag, or an
   * ArrowLeft/ArrowRight/Home/End press. Omit to render the handle as fixed (no `role="separator"`
   * at all), which is how every existing host that has not opted in keeps its unresizable rail.
   */
  readonly onWidthChange?: ((px: number) => void) | undefined;
}

/**
 * The window's current inline size in px, live across resizes.
 *
 * @remarks
 * Only consulted for the resize handle's bounds ({@link railResizeMaxPx}) and its `aria-valuemax`,
 * both of which need the real viewport rather than the last one `useMediaQuery` happened to check
 * against a breakpoint. `useSyncExternalStore` keeps the SSR snapshot deterministic — a nonzero
 * fallback rather than `0`, so a stored width read before hydration never appears to exceed the
 * server's idea of the maximum.
 */
function useWindowInlineSize(): number {
  const subscribe = React.useCallback((onChange: () => void): (() => void) => {
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('resize', onChange);
    };
  }, []);
  const getSnapshot = React.useCallback(() => window.innerWidth, []);
  const getServerSnapshot = React.useCallback(() => RAIL_MAX_INLINE_SIZE_PX * 4, []);
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Props for {@link ShellAsideResizeHandle}. */
interface ShellAsideResizeHandleProps {
  /** The panel this handle resizes, for its accessible name. */
  readonly panel: RailPanel;
  /** The rail's current inline size in px (a stored width, or the resolved clamp). */
  readonly widthPx: number;
  /** Report a new width, from a drag or a key press. */
  readonly onWidthChange: (px: number) => void;
}

/**
 * The rail's resize handle: a 6px hit area on its inner edge (the edge facing `<main>`), tonal
 * only — no border, ever. Dragging it, or pressing Left/Right/Home/End while it has focus, hands a
 * new width straight to {@link ShellAsideResizeHandleProps.onWidthChange}; persisting it is the
 * shell's job, not this handle's.
 *
 * @remarks
 * Left widens the rail and Right narrows it, because the edge this handle sits on faces `<main>`:
 * dragging it further left is dragging it further into `<main>`'s space, which is what widening the
 * rail *is*. A pointer drag follows the same convention — the pointer moving left by `dx` grows the
 * rail by `dx`, using `window`-level listeners (not pointer capture) so the drag survives the
 * pointer leaving the handle's own 6px hit area.
 */
function ShellAsideResizeHandle({
  panel,
  widthPx,
  onWidthChange,
}: ShellAsideResizeHandleProps): React.JSX.Element {
  const viewportPx = useWindowInlineSize();
  const maxPx = railResizeMaxPx(viewportPx);
  const [dragging, setDragging] = React.useState(false);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${panel.label}`}
      aria-valuenow={Math.round(widthPx)}
      aria-valuemin={RAIL_MIN_INLINE_SIZE_PX}
      aria-valuemax={Math.round(maxPx)}
      tabIndex={0}
      className="group absolute inset-y-0 left-0 z-10 flex w-1.5 cursor-col-resize touch-none items-stretch justify-center outline-none"
      onKeyDown={(event) => {
        const currentMaxPx = railResizeMaxPx(window.innerWidth);
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onWidthChange(Math.min(widthPx + RAIL_RESIZE_STEP_PX, currentMaxPx));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onWidthChange(Math.max(widthPx - RAIL_RESIZE_STEP_PX, RAIL_MIN_INLINE_SIZE_PX));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onWidthChange(RAIL_MIN_INLINE_SIZE_PX);
        } else if (event.key === 'End') {
          event.preventDefault();
          onWidthChange(currentMaxPx);
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidthPx = widthPx;
        setDragging(true);
        const onMove = (moveEvent: PointerEvent): void => {
          const currentMaxPx = railResizeMaxPx(window.innerWidth);
          const dx = startX - moveEvent.clientX;
          onWidthChange(
            Math.min(Math.max(startWidthPx + dx, RAIL_MIN_INLINE_SIZE_PX), currentMaxPx),
          );
        };
        const onUp = (): void => {
          setDragging(false);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
    >
      {/* The only visible part: a 2px tonal bar, centred in the 6px hit area. Background only —
          zero borders is a hard rule on this surface, so hover/focus/drag all read as a fill. */}
      <div
        aria-hidden="true"
        className={cn(
          'h-full w-0.5 rounded-full bg-transparent transition-colors',
          'group-hover:bg-outline-variant group-focus-visible:bg-outline-variant',
          dragging && 'bg-outline-variant',
        )}
      />
    </div>
  );
}

/** How the rail's width and its inner pin resolve, for a given open/collapsed and stored width. */
interface RailWidthPresentation {
  /** The width every render actually paints with: the stored px, or {@link railClampWidthPx}. */
  readonly resolvedWidthPx: number;
  /** The outer wrapper's width style — `undefined` collapsed, where the `w-0` class wins instead. */
  readonly asideStyle: React.CSSProperties | undefined;
  /** `w-0` collapsed, or just the activity-bar gap while the width lives in {@link asideStyle}. */
  readonly asideWidthClassName: string;
  /** The inner pin's width — always painted, so content doesn't reflow while sliding out of view. */
  readonly innerStyle: React.CSSProperties;
}

/**
 * Resolve the rail's and its inner pin's width presentation once, so {@link ShellAside} assigns
 * plain values rather than repeating the same `open` branch in several places.
 *
 * @remarks
 * Both a stored width and the unstored default are already concrete pixel numbers — unlike the
 * viewport-share clamp this replaced, neither needs a CSS expression to stay correct across
 * hydration, so every width here is a plain inline style.
 *
 * @param open - Whether the rail is expanded (`!collapsed`).
 * @param width - A stored width in px, or `undefined` to keep {@link railClampWidthPx}'s default.
 * @param viewportPx - The window's current inline size, for resolving the default's own bound.
 */
function resolveRailWidthPresentation(
  open: boolean,
  width: number | undefined,
  viewportPx: number,
): RailWidthPresentation {
  const resolvedWidthPx = width ?? railClampWidthPx(viewportPx);
  const style: React.CSSProperties = { width: `${String(resolvedWidthPx)}px` };
  return {
    resolvedWidthPx,
    asideStyle: open ? style : undefined,
    asideWidthClassName: open ? 'mr-2' : 'w-0',
    innerStyle: style,
  };
}

/**
 * The desktop panel host: a width-animated surface rendering the active panel; the bar handles toggling.
 *
 * @remarks
 * Hidden below `lg` **in CSS, not in JS**, and rendered by {@link AppShell} at every desktop width.
 * Both details are load-bearing for the layout contract: a CSS-only presence means the first paint is
 * already the final layout (no hydration reflow), and being present at every desktop width — even
 * collapsed, at zero width — keeps the shell's fixed chrome the *same* 312px at 1024px as at 1920px.
 * When the host was conditionally mounted, its flex gap alone made `<main>` 7px narrower at 1440 than
 * at 1439.
 *
 * The panel body sees a `@container` context, so a panel lays itself out against the rail's real
 * inline size (a person-chosen pixel width, not a viewport share) rather than a viewport breakpoint.
 */
export function ShellAside({
  panel,
  collapsed,
  width,
  onWidthChange,
}: ShellAsideProps): React.JSX.Element {
  const open = !collapsed;
  const viewportPx = useWindowInlineSize();
  const presentation = resolveRailWidthPresentation(open, width, viewportPx);
  // Captured together so `onWidthChange`'s presence narrows inside the branch below, rather than
  // through a boolean flag TypeScript cannot connect back to it.
  const resizeHandle =
    open && onWidthChange ? { widthPx: presentation.resolvedWidthPx, onWidthChange } : null;

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
      style={presentation.asideStyle}
      className={cn(
        // Tonal surface (no border and no shadow — the surface step off the canvas carries the
        // separation, and a second shadowed box beside `<main>` framed the content twice); width is
        // the only animated property, and it's a flex sibling of `<main>`, so the panel reflows in one
        // continuous motion. Collapsed → zero width; the always-visible activity bar is the reopen.
        // `relative` gives the resize handle below a positioning root scoped to this rail alone.
        surfaceToneColor('page'),
        '@container relative hidden h-full min-h-0 shrink-0 overflow-hidden rounded-xl lg:block',
        animating && 'transition-[width,margin] duration-(--dur-slow) ease-in-out',
        presentation.asideWidthClassName,
      )}
    >
      {/* Inner pinned to the expanded width so the content never reflows while the wrapper animates
          its width — it slides out of view instead of relaying out on every frame. */}
      <div style={presentation.innerStyle} className="h-full min-h-0 overflow-hidden">
        {panel.node}
      </div>
      {resizeHandle ? <ShellAsideResizeHandle panel={panel} {...resizeHandle} /> : null}
    </aside>
  );
}
