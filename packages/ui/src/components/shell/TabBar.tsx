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
 */
import * as React from 'react';

import {
  FolderKanban,
  GanttChart,
  Layers,
  type LucideIcon,
  RefreshCw,
  Sparkles,
  Target,
  X,
} from '../../icons';
import { cn } from '../../lib/utils';

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

/** Props for {@link TabBar}. */
export interface TabBarProps {
  /** The caller's open documents, left-to-right. */
  readonly tabs: readonly OpenTab[];
  /** The key of the active (currently-viewed) tab, if any. */
  readonly activeKey?: string;
  /** Render a routing link element around a tab's content (host's `Link`). */
  readonly renderLink: (href: string, children: React.ReactNode) => React.ReactNode;
  /** Close a tab by key (host removes it from the store and routes to a neighbor/base). */
  readonly onClose: (key: string) => void;
}

/** Glyph for each document kind. */
const TYPE_ICON: Record<TabDocType, LucideIcon> = {
  task: Target,
  project: FolderKanban,
  initiative: Sparkles,
  program: Layers,
  cycle: RefreshCw,
  session: GanttChart,
};

/**
 * The multi-document tab strip.
 *
 * @remarks
 * Renders `null` when `tabs` is empty so it consumes no space until a document is opened.
 */
export function TabBar({
  tabs,
  activeKey,
  renderLink,
  onClose,
}: TabBarProps): React.JSX.Element | null {
  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="border-border bg-card flex h-10 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b px-1.5"
    >
      {tabs.map((tab) => {
        const Icon = TYPE_ICON[tab.type];
        const active = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={active}
            className={cn(
              'group relative flex max-w-52 min-w-0 items-center self-center rounded-md text-sm',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {renderLink(
              tab.href,
              <span className="focus-visible:ring-ring flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-1 pl-2 focus-visible:ring-2 focus-visible:outline-none">
                <Icon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate">{tab.title}</span>
              </span>,
            )}
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={() => {
                onClose(tab.key);
              }}
              className="hover:bg-background/80 focus-visible:ring-ring mr-1 flex size-5 shrink-0 items-center justify-center rounded opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
