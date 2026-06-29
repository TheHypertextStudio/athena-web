'use client';

import * as React from 'react';

import { X } from '../../icons';
import { cn } from '../../lib/utils';
import { focusRing, Tooltip, TooltipContent, TooltipTrigger } from '../../primitives';

import type { OpenTab, TabRenderLink } from './tab-types';
import { TYPE_ICON } from './tab-types';

interface TabItemProps {
  readonly tab: OpenTab;
  readonly active: boolean;
  readonly renderLink: TabRenderLink;
  readonly onClose: (key: string) => void;
}

/** TabItem renders the shell navigation UI control for its parent workflow. */
export function TabItem({ tab, active, renderLink, onClose }: TabItemProps): React.JSX.Element {
  const Icon = TYPE_ICON[tab.type];
  return (
    <div
      role="tab"
      aria-selected={active}
      className={cn(
        'group text-body relative flex h-8 w-40 shrink-0 items-center rounded-lg transition-colors',
        active
          ? 'text-on-secondary-container bg-secondary-container shadow-sm'
          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
      )}
    >
      {renderLink(
        tab.href,
        <>
          <Icon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{tab.title}</span>
        </>,
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
