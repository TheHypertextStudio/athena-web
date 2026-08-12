import {
  FolderKanban,
  GanttChart,
  Layers,
  type LucideIcon,
  RefreshCw,
  TaskAlt,
  Target,
} from '../../icons';
import type * as React from 'react';

/** The kinds of document a tab can represent (drives the leading glyph). */
export type TabDocType = 'task' | 'project' | 'initiative' | 'program' | 'cycle' | 'session';

/** A single open document in the {@link TabBar}. */
export interface OpenTab {
  readonly key: string;
  readonly type: TabDocType;
  readonly orgId: string;
  readonly id: string;
  /**
   * The document's name, or `null` while it is still unknown.
   *
   * @remarks
   * Nullable on purpose. A tab is opened the instant a route resolves, which is before anything
   * has read the document it points at — and the previous stand-in for that moment was a slice of
   * the document's id ("Project 01HZX5"). An internal identifier is not a name, and because
   * unresolved titles were persisted like any other, a tab that failed to resolve kept one for
   * the rest of the session. `null` says "not known yet" so the bar can show what kind of
   * document it is instead of what its primary key looks like.
   */
  readonly title: string | null;
  readonly href: string;
}

/** What to call each kind of document before its own name is known. */
export const TYPE_LABEL: Record<TabDocType, string> = {
  task: 'Task',
  project: 'Project',
  initiative: 'Initiative',
  program: 'Program',
  cycle: 'Cycle',
  session: 'Session',
};

/**
 * What a tab should read as right now.
 *
 * @param tab - The open document.
 * @returns Its title, or the kind of document it is while that title is unknown.
 */
export function tabLabel(tab: OpenTab): string {
  return tab.title ?? TYPE_LABEL[tab.type];
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

/** Glyph for each document kind. */
export const TYPE_ICON: Record<TabDocType, LucideIcon> = {
  task: TaskAlt,
  project: FolderKanban,
  initiative: Target,
  program: Layers,
  cycle: RefreshCw,
  session: GanttChart,
};
