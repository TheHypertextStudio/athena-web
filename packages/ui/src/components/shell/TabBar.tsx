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
 * @remarks Layout model — each tab **flexes between a floor and a ceiling** (`min-w-24` to
 * `max-w-60`): tabs spread into free width so titles get room before truncating, and shrink
 * toward the floor under crowding. Inside a tab the title **flexes** (`flex-1 min-w-0`) and
 * truncates with an ellipsis, while the close button is pinned to the right edge (`shrink-0`);
 * the two never overlap regardless of title length. The title is
 * the host's routing anchor (via {@link TabBarProps.renderLink}, which is handed the flex classes
 * so the anchor itself participates in the tab's flex row). Once more than five documents are
 * open, the strip shows the active document and its nearest neighbors (or the last three when
 * none is active). It can still scroll horizontally without growing a second row. The pinned
 * **searchable switcher** lists *every* open document (type glyph + title) so the caller can jump
 * to or close one that is outside the strip. The switcher is 352px below the desktop breakpoint and
 * caps at 480px on desktop, opens directly into its search field from the trigger or
 * Command/Control+Shift+A, and uses ordinary Tab order across each link and close action instead
 * of imposing menu semantics on a compound interactive row.
 *
 * @remarks Surface model — the bar is its **own bar on the canvas**: its container inherits the
 * shell's tinted `surface-container` tone. Inactive tabs rest directly on that canvas and gain a
 * fill on hover or keyboard focus. Only the active tab carries a persistent `surface` fill. This
 * keeps a crowded strip quiet while preserving the selected document's identity. Close controls
 * remain available on every tab and become visible on interaction, including touch.
 *
 * @remarks Inline responsiveness — the icon-only controls (each tab's close button and the
 * pinned switcher trigger) carry a {@link Tooltip} naming them on hover/focus, so a wordless
 * glyph still announces its action. The bar mounts its own {@link TooltipProvider} so the
 * treatment works even when the bar is rendered outside the app-wide provider.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { surfaceToneColor, TooltipProvider } from '../../primitives';

import { TabItem } from './tab-item';
import { OverflowMenu } from './tab-overflow-menu';
import type { TabDocType, TabRenderLink } from './tab-types';
import type { OpenTab } from './tab-types';
import { TYPE_LABEL, tabLabel } from './tab-types';

export type { OpenTab, TabDocType, TabRenderLink };
export { TYPE_LABEL, tabLabel };

/** The shared 40px block occupied by the visible (desktop) document-tab row. */
export const TAB_BAR_BLOCK_SIZE_CLASS = 'h-10';

/** Keep small sets intact, then leave enough width for three readable document titles. */
const MAX_FULL_STRIP_TABS = 5;
const CROWDED_STRIP_TABS = 3;

/** Props for {@link TabBar}. */
export interface TabBarProps {
  /** The caller's open documents, left-to-right. */
  readonly tabs: readonly OpenTab[];
  /** The key of the active (currently-viewed) tab, if any. */
  readonly activeKey?: string | undefined;
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
 * second row), and pins an {@link OverflowMenu} at the right edge that filters every open
 * document locally — so a bar with dozens of tabs stays navigable.
 *
 * It is a desktop affordance: below `lg`, where the shell trades its sidebar for the mobile top
 * bar, the strip is hidden so the page keeps the screen height. Open documents are still recorded,
 * and reappear the moment the window is wide enough.
 */
export function TabBar({
  tabs,
  activeKey,
  renderLink,
  onClose,
}: TabBarProps): React.JSX.Element | null {
  const tablistRef = React.useRef<HTMLDivElement>(null);
  const activeIndex = tabs.findIndex((tab) => tab.key === activeKey);
  const windowStart =
    activeIndex < 0
      ? tabs.length - CROWDED_STRIP_TABS
      : Math.min(Math.max(0, activeIndex - 1), tabs.length - CROWDED_STRIP_TABS);
  const visibleTabs =
    tabs.length <= MAX_FULL_STRIP_TABS
      ? tabs
      : tabs.slice(windowStart, windowStart + CROWDED_STRIP_TABS);

  React.useLayoutEffect(() => {
    const selectedTab = tablistRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    // Browser engines provide this method, but the jsdom test runtime does not.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    selectedTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeKey, tabs]);

  if (tabs.length === 0) return null;

  return (
    <TooltipProvider delayDuration={400}>
      {/*
        No horizontal inset: the first pill's left edge and the overflow trigger's right edge sit
        flush with the content column, so the strip lines up with the panel (and any banner) below
        instead of floating 8px inside them.
      */}
      <div
        className={cn(
          surfaceToneColor('canvas'),
          `no-print flex ${TAB_BAR_BLOCK_SIZE_CLASS} shrink-0 items-center overflow-hidden max-lg:hidden`,
        )}
      >
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Open documents"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden"
        >
          {visibleTabs.map((tab) => (
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
