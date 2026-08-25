'use client';

import * as React from 'react';

import { ChevronDown } from '../../icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../primitives';
import { cn } from '../../lib/utils';
import type { RailPanel } from './ShellAside';

/** Props for the mobile utility sheet's active-panel menu. */
export interface MobilePanelSwitcherProps {
  /** Every utility panel available on the current route. */
  readonly panels: readonly RailPanel[];
  /** The panel whose content the utility sheet currently shows. */
  readonly activePanel: RailPanel;
  /** Select one panel without closing the utility sheet. */
  readonly onSelect: (id: string) => void;
}

/** Render one fixed-size selector whose menu scales independently of the sheet header. */
export function MobilePanelSwitcher({
  panels,
  activePanel,
  onSelect,
}: MobilePanelSwitcherProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Panel: ${activePanel.label}. Switch panel`}
          className="text-on-surface hover:bg-surface-container-high focus-visible:ring-ring text-label-large flex h-10 max-w-full min-w-0 items-center gap-2 rounded-lg px-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <span aria-hidden="true" className="shrink-0 [&_svg]:size-4">
            {activePanel.icon}
          </span>
          <span
            title={activePanel.label}
            className="min-w-0 flex-1 truncate text-left whitespace-nowrap"
          >
            {activePanel.label}
          </span>
          <ChevronDown aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="lg">
        {panels.map((panel) => (
          <DropdownMenuItem
            key={panel.id}
            selected={panel.id === activePanel.id}
            supporting={
              panel.status ? (
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    data-panel-status-tone={panel.status.tone}
                    className={cn(
                      'size-2 rounded-full',
                      panel.status.tone === 'active' && 'bg-state-started',
                      panel.status.tone === 'muted' && 'bg-on-surface-variant',
                      panel.status.tone === 'attention' && 'bg-primary',
                    )}
                  />
                  {panel.status.label}
                </span>
              ) : undefined
            }
            onSelect={() => {
              onSelect(panel.id);
            }}
          >
            <span aria-hidden="true" className="shrink-0 [&_svg]:size-4">
              {panel.icon}
            </span>
            <span className="truncate">{panel.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
