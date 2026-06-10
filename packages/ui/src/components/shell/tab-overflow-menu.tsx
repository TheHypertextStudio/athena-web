'use client';

import * as React from 'react';

import { ChevronDown, X } from '../../icons';
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
  TooltipTrigger,
} from '../../primitives';

import type { OpenTab, TabRenderLink } from './tab-types';
import { TYPE_ICON } from './tab-types';

interface OverflowMenuProps {
  readonly tabs: readonly OpenTab[];
  readonly activeKey?: string;
  readonly renderLink: TabRenderLink;
  readonly onClose: (key: string) => void;
}

export function OverflowMenu({
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
