'use client';

/**
 * The desktop dock that keeps the supplemental panel and its activity bar aligned with page content.
 *
 * The document tab row belongs to the content column. When it is visible, this dock consumes the
 * same shared block before its panel row so the three desktop surfaces begin and end together.
 */
import * as React from 'react';

import { TAB_BAR_BLOCK_SIZE_CLASS } from './TabBar';
import { ShellActivityBar } from './ShellActivityBar';
import { ShellAside, type RailPanel } from './ShellAside';

/** Props for {@link ShellRailDock}. */
export interface ShellRailDockProps {
  /** The supplemental panel rendered by the dock. */
  readonly panel: RailPanel;
  /** Every panel that the activity bar can select. */
  readonly panels: readonly RailPanel[];
  /** The id of the selected panel. */
  readonly activeId: string;
  /** Whether the panel body is collapsed while its activity bar remains visible. */
  readonly collapsed: boolean;
  /** Whether the content column is rendering a real, visible document tab row. */
  readonly tabBarPresent: boolean;
  /** Select or collapse a panel from the activity bar. */
  readonly onIconClick: (id: string) => void;
}

/**
 * Dock the right-hand panel and activity bar beside the content column.
 *
 * The outer dock is one shell flex child. Its inner row restores the gap between the panel and the
 * activity bar, which preserves the desktop width contract while letting both start below the tab
 * bar only when that bar has real rendered height.
 */
export function ShellRailDock({
  panel,
  panels,
  activeId,
  collapsed,
  tabBarPresent,
  onIconClick,
}: ShellRailDockProps): React.JSX.Element {
  return (
    <div className="hidden h-full min-h-0 shrink-0 flex-col lg:flex">
      {tabBarPresent ? <div aria-hidden="true" className={TAB_BAR_BLOCK_SIZE_CLASS} /> : null}
      <div className="flex min-h-0 flex-1 gap-2">
        <ShellAside panel={panel} collapsed={collapsed} />
        <ShellActivityBar
          panels={panels}
          activeId={activeId}
          collapsed={collapsed}
          onIconClick={onIconClick}
        />
      </div>
    </div>
  );
}
