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
 * chrome floating above the main content panel rather than a strip *inside* it. The **active**
 * tab takes the panel's `surface` tone with rounded top corners and a flush bottom edge, so it
 * visually fuses with the rounded `<main>` surface directly below it; **inactive** tabs sit on
 * the canvas in muted `on-surface-variant`, stepping up the container ramp on hover.
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
 * A single fixed-width tab: a flexing, truncating title and a right-pinned close button.
 *
 * @remarks
 * The tab is a flex row. The host's routing anchor is the flexing child (`flex-1 min-w-0`) so
 * the title fills the available space and truncates with an ellipsis; the close button is
 * `shrink-0` and therefore always sits flush at the right edge, never overlapping the title.
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
        // important at narrow/mobile widths. The inner title flexes + truncates within.
        'group relative flex w-40 shrink-0 items-center text-sm',
        active
          ? // The active tab fuses with the rounded main panel below: it takes the panel's
            // surface tone, rounds only its top corners, and runs flush to the bar's bottom.
            // A soft shadow lifts it off the tinted strip so the selected tab stays legible
            // even in light mode, where the panel surface and strip are both near-white.
            'text-on-surface bg-surface self-stretch rounded-t-lg shadow-sm'
          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface mb-1 self-center rounded-md',
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
        'focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-1 pl-2 focus-visible:ring-2 focus-visible:outline-none',
      )}
      <button
        type="button"
        aria-label={`Close ${tab.title}`}
        onClick={() => {
          onClose(tab.key);
        }}
        className="hover:bg-surface-container-highest focus-visible:ring-ring mr-1 flex size-5 shrink-0 items-center justify-center rounded opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
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
      <DropdownMenuTrigger
        type="button"
        aria-label={`Open documents (${String(tabs.length)})`}
        className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring data-[state=open]:bg-surface-container-high mb-1 flex h-7 shrink-0 items-center gap-0.5 self-center rounded-md px-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="tabular-nums">{tabs.length}</span>
        <ChevronDown aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
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
                    <Icon aria-hidden="true" className="size-4 shrink-0 opacity-70" />
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
                  className="hover:bg-surface-container-high focus-visible:ring-ring mr-1 flex size-6 shrink-0 items-center justify-center rounded opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X aria-hidden="true" className="size-3.5" />
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
    <div className="bg-surface-container flex h-10 shrink-0 items-stretch overflow-hidden pr-1.5">
      {/*
        The scrolling track holds the tabs. It scrolls horizontally and CLIPS vertical overflow
        (`overflow-y-hidden`) so a tall active tab or a margin never lets the strip scroll
        vertically or grow a second row — the chrome stays exactly `h-10`.
      */}
      <div
        role="tablist"
        aria-label="Open documents"
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden px-1.5 pt-1.5"
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
      <div className="flex shrink-0 items-end pt-1.5 pl-1">
        <OverflowMenu tabs={tabs} activeKey={activeKey} renderLink={renderLink} onClose={onClose} />
      </div>
    </div>
  );
}
