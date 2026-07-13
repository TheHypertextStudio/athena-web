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

import { TooltipProvider } from '../../primitives';

import { TabItem } from './tab-item';
import { OverflowMenu } from './tab-overflow-menu';
import type { TabDocType, TabRenderLink } from './tab-types';
import type { OpenTab } from './tab-types';

export type { OpenTab, TabDocType, TabRenderLink };

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
    <TooltipProvider delayDuration={400}>
      <div className="no-print bg-surface-container flex h-10 shrink-0 items-center overflow-hidden pr-1.5">
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
