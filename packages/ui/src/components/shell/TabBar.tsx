'use client';

/**
 * `@docket/ui` — the multi-document tab bar.
 *
 * @remarks
 * An IDE/browser-style tab strip rendered in the {@link AppShell} above the main content. It
 * surfaces the caller's open documents (tasks, projects, …) so deep work survives navigating
 * away and back. Each tab carries a type glyph, the document title, the active highlight, and
 * a close button; clicking a tab navigates to it (rendered as a real anchor via the host's
 * `renderLink` so it is keyboard-accessible) and closing removes it. The tab bar is purely
 * presentational — the open-documents store lives in the host app, which feeds tabs in and
 * handles {@link TabBarProps.onClose}. It renders nothing when no documents are open, so it
 * costs no vertical space until the caller actually opens one.
 *
 * @remarks Layout model — each tab is a **fixed width** that never shrinks. Inside it the title
 * **flexes** (`flex-1 min-w-0`) and truncates with an ellipsis, while the close button is pinned
 * to the right edge (`shrink-0`); the two never overlap regardless of title length. The title is
 * the host's routing anchor (via {@link TabBarProps.renderLink}, which is handed the flex classes
 * so the anchor itself participates in the tab's flex row). A crowded bar **scrolls horizontally
 * only** — the strip clips vertical overflow so the chrome never grows a second row or a vertical
 * scrollbar. An always-present **overflow menu** pinned at the right edge lists *every* open
 * document (type glyph + title) so the caller can jump to or close any tab even when dozens are
 * open and most have scrolled out of view — keeping the bar usable with 3 tabs or 30.
 *
 * @remarks Surface model — the bar is its **own bar on the canvas**: its container inherits the
 * shell's tinted `surface-container` tone (no panel surface, no divider border), so it reads as
 * chrome floating above the main content panel rather than a strip *inside* it. Each tab is a
 * **detached floating pill** — fully rounded (`rounded-lg`), vertically centred, and a consistent
 * height — that sits *on* the canvas rather than being welded to the panel below; the bar keeps a
 * real visual gap above the main panel (the shell gutter) so the strip and the panel read as two
 * separate layers. The **active** pill is visually *lifted* (`surface-container-highest` fill plus
 * a subtle ring + shadow) and inks its label in `on-surface`; **inactive** pills stay calm
 * (transparent, muted `on-surface-variant`), stepping up to `surface-container-high` on hover.
 *
 * @remarks Inline responsiveness — the icon-only controls (each tab's close button and the
 * pinned overflow trigger) carry a {@link Tooltip} naming them on hover/focus, so a wordless
 * glyph still announces its action. The bar mounts its own {@link TooltipProvider} so the
 * treatment works even when the bar is rendered outside the app-wide provider.
 */
import * as React from 'react';

import {
  ChevronDown,
  FolderKanban,
  GanttChart,
  Layers,
  type LucideIcon,
  RefreshCw,
  TaskAlt,
  Target,
  X,
} from '../../icons';
import { cn } from '../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  focusRing,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../primitives';

/** The kinds of document a tab can represent (drives the leading glyph). */
export type TabDocType = 'task' | 'project' | 'initiative' | 'program' | 'cycle' | 'session';

/** A single open document in the {@link TabBar}. */
export interface OpenTab {
  /** A stable key for this tab (e.g. `task:ORG…:TASK…`); also React's list key. */
  readonly key: string;
  /** The document kind, selecting the leading glyph. */
  readonly type: TabDocType;
  /** The owning org id (tabs are org-scoped). */
  readonly orgId: string;
  /** The document id. */
  readonly id: string;
  /** The display title (resolved by the host; falls back to a loading placeholder). */
  readonly title: string;
  /** The route this tab navigates to. */
  readonly href: string;
}

/**
 * Render a routing link element around a tab's content (the host's `Link`).
 *
 * @remarks
 * The `className` is supplied so the host's anchor can carry the tab's flex classes and become
 * a real flex child of the tab row — without it the title would not fill the tab and the close
 * button could not stay pinned to the right. Hosts that share one `renderLink` across the
 * sidebar and the tab bar can accept the extra argument as optional and ignore it elsewhere.
 */
export type TabRenderLink = (
  href: string,
  children: React.ReactNode,
  className?: string,
) => React.ReactNode;

/** Props for {@link TabBar}. */
export interface TabBarProps {
  /** The caller's open documents, left-to-right. */
  readonly tabs: readonly OpenTab[];
  /** The key of the active (currently-viewed) tab, if any. */
  readonly activeKey?: string;
  /** Render a routing link element around a tab's content (host's `Link`). */
  readonly renderLink: TabRenderLink;
  /** Close a tab by key (host removes it from the store and routes to a neighbor/base). */
  readonly onClose: (key: string) => void;
}

/** Glyph for each document kind. */
const TYPE_ICON: Record<TabDocType, LucideIcon> = {
  task: TaskAlt,
  project: FolderKanban,
  // The 'target' glyph reads as an initiative (a goal to aim at), not a task.
  initiative: Target,
  program: Layers,
  cycle: RefreshCw,
  session: GanttChart,
};

/** Props for one rendered {@link TabItem}. */
interface TabItemProps {
  /** The open document this tab represents. */
  readonly tab: OpenTab;
  /** Whether this tab is the active (currently-viewed) one. */
  readonly active: boolean;
  /** Render the host's routing anchor around the title (handed the flex classes). */
  readonly renderLink: TabRenderLink;
  /** Close this tab. */
  readonly onClose: (key: string) => void;
}

/**
 * A single fixed-width, fully-rounded **floating pill** tab: a flexing, truncating title and a
 * right-pinned close button.
 *
 * @remarks
 * The pill is a self-contained flex row with a consistent height (`h-8`), fully rounded
 * (`rounded-lg`), and vertically centred on the strip — it is *not* welded to the panel below.
 * The host's routing anchor is the flexing child (`flex-1 min-w-0`) so the title fills the
 * available space and truncates with an ellipsis; the close button is `shrink-0` and therefore
 * always sits flush at the right edge, never overlapping the title. The **active** pill is lifted
 * off the canvas (`surface-container-highest` fill, a subtle `ring` and `shadow-sm`); **inactive**
 * pills are transparent and calm, warming to `surface-container-high` on hover.
 */
function TabItem({ tab, active, renderLink, onClose }: TabItemProps): React.JSX.Element {
  const Icon = TYPE_ICON[tab.type];
  return (
    <div
      role="tab"
      aria-selected={active}
      className={cn(
        // Tabs keep a fixed width and never shrink, so a crowded bar scrolls horizontally (the
        // strip is overflow-x-auto) instead of squishing tabs until their content overlaps —
        // important at narrow/mobile widths. The inner title flexes + truncates within. Each tab
        // is a fully-rounded pill of a consistent height; the strip centres it so it floats on
        // the canvas with a real gap to the panel below rather than fusing to it.
        'group relative flex h-8 w-40 shrink-0 items-center rounded-lg text-sm transition-colors',
        active
          ? // The active pill is *lifted*: a stepped-up container fill plus a subtle ring + shadow
            // separate it from the calm inactive pills and from the canvas, staying legible in
            // light mode where the surfaces sit close together. It does NOT touch the panel below.
            'text-on-surface bg-surface-container-highest ring-outline-variant shadow-sm ring-1'
          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
      )}
    >
      {renderLink(
        tab.href,
        <>
          <Icon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{tab.title}</span>
        </>,
        // The anchor itself is the flexing child of the tab row: it fills the width (`flex-1
        // min-w-0`) so its title truncates, and leaves room for the close button to its right.
        cn(
          'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1.5 pr-1 pl-2.5',
          focusRing,
        ),
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Close ${tab.title}`}
            onClick={() => {
              onClose(tab.key);
            }}
            className={cn(
              'hover:bg-surface-container-highest mr-1 flex size-6 shrink-0 items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100',
              focusRing,
            )}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Close tab</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Props for the {@link OverflowMenu}. */
interface OverflowMenuProps {
  /** Every open document, so the caller can jump to or close any tab from one place. */
  readonly tabs: readonly OpenTab[];
  /** The active tab's key, marked in the list. */
  readonly activeKey?: string;
  /** Render the host's routing anchor for a jump-to row. */
  readonly renderLink: TabRenderLink;
  /** Close a tab by key. */
  readonly onClose: (key: string) => void;
}

/**
 * The pinned overflow control: a dropdown listing every open document to jump to or close.
 *
 * @remarks
 * Always available at the right edge of the strip (it does not depend on measuring overflow),
 * it is the strategy for a crowded bar: the visible tabs scroll horizontally, and this menu
 * gives one-click access to *any* open document — including the ones scrolled out of view — by
 * title, plus a close affordance per row. It is a proper Radix menu (focus management, `Esc` to
 * dismiss, arrow-key navigation), and its trigger announces the open-document count.
 */
function OverflowMenu({
  tabs,
  activeKey,
  renderLink,
  onClose,
}: OverflowMenuProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            type="button"
            aria-label={`Open documents (${String(tabs.length)})`}
            className={cn(
              'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface data-[state=open]:bg-surface-container-high flex h-8 shrink-0 items-center gap-0.5 self-center rounded-lg px-1.5 text-xs font-medium transition-colors',
              focusRing,
            )}
          >
            <span className="tabular-nums">{tabs.length}</span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>All open documents</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-on-surface-variant text-xs">
          Open documents
        </DropdownMenuLabel>
        {tabs.map((tab) => {
          const Icon = TYPE_ICON[tab.type];
          const active = tab.key === activeKey;
          return (
            <DropdownMenuItem
              key={tab.key}
              asChild
              aria-current={active ? 'true' : undefined}
              className={cn('gap-0 p-0', active && 'bg-surface-container-highest')}
            >
              <div className="flex items-center">
                {renderLink(
                  tab.href,
                  <>
                    <Icon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  </>,
                  'flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1.5 pr-1 pl-2 outline-none',
                )}
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={(event) => {
                    // Closing must not navigate via the row's anchor or dismiss-then-jump.
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(tab.key);
                  }}
                  className={cn(
                    'hover:bg-surface-container-high mr-1 flex size-6 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100',
                    focusRing,
                  )}
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The multi-document tab strip.
 *
 * @remarks
 * Renders `null` when `tabs` is empty so it consumes no space until a document is opened. The
 * strip scrolls horizontally only (vertical overflow is clipped so the chrome never grows a
 * second row), and pins an {@link OverflowMenu} at the right edge that lists every open
 * document — so a bar with dozens of tabs stays navigable.
 */
export function TabBar({
  tabs,
  activeKey,
  renderLink,
  onClose,
}: TabBarProps): React.JSX.Element | null {
  if (tabs.length === 0) return null;

  return (
    // A self-contained TooltipProvider so the icon-only controls (each tab's close button and the
    // overflow trigger) name themselves on hover/focus even when the bar is rendered outside the
    // app-wide provider; nesting under the app's provider is supported and simply inherits timing.
    <TooltipProvider delayDuration={400}>
      <div className="bg-surface-container flex h-10 shrink-0 items-center overflow-hidden pr-1.5">
        {/*
          The scrolling track holds the tabs. It scrolls horizontally and CLIPS vertical overflow
          (`overflow-y-hidden`) so a tall pill or a focus ring never lets the strip scroll
          vertically or grow a second row — the chrome stays exactly `h-10`. The pills are
          vertically centred so they float on the canvas with breathing room above the main panel
          below, not fused to it.
        */}
        <div
          role="tablist"
          aria-label="Open documents"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden px-1.5"
        >
          {tabs.map((tab) => (
            <TabItem
              key={tab.key}
              tab={tab}
              active={tab.key === activeKey}
              renderLink={renderLink}
              onClose={onClose}
            />
          ))}
        </div>
        {/* The overflow control is pinned outside the scroll track so it is always reachable. */}
        <div className="flex shrink-0 items-center pl-1">
          <OverflowMenu
            tabs={tabs}
            activeKey={activeKey}
            renderLink={renderLink}
            onClose={onClose}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
