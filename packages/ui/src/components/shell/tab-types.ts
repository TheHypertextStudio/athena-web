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
  readonly title: string;
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

/** Glyph for each document kind. */
export const TYPE_ICON: Record<TabDocType, LucideIcon> = {
  task: TaskAlt,
  project: FolderKanban,
  initiative: Target,
  program: Layers,
  cycle: RefreshCw,
  session: GanttChart,
};
