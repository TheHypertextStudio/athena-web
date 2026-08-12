'use client';

import * as React from 'react';

import { X } from '../../icons';
import { cn } from '../../lib/utils';
import {
  focusRing,
  focusRingInset,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../primitives';

import type { OpenTab, TabRenderLink } from './tab-types';
import { TYPE_ICON, tabLabel } from './tab-types';

interface TabItemProps {
  readonly tab: OpenTab;
  readonly active: boolean;
  readonly renderLink: TabRenderLink;
  readonly onClose: (key: string) => void;
}

/** TabItem renders the shell navigation UI control for its parent workflow. */
export function TabItem({ tab, active, renderLink, onClose }: TabItemProps): React.JSX.Element {
  const Icon = TYPE_ICON[tab.type];
  // Until the document's own name is read, the tab says what kind of thing it is. It never says
  // what its id looks like: an internal identifier tells the reader nothing and, once persisted,
  // used to stay that way.
  const label = tabLabel(tab);
  const unresolved = tab.title === null;
  return (
    <div
      role="tab"
      aria-selected={active}
      className={cn(
        'group text-label-large relative flex h-8 max-w-60 min-w-24 flex-1 shrink items-center rounded-md transition-colors',
        active
          ? 'bg-surface text-on-surface'
          : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface',
      )}
    >
      {renderLink(
        tab.href,
        <>
          <Icon aria-hidden="true" className="size-4 shrink-0 opacity-70" />
          <span className={cn('min-w-0 flex-1 truncate', unresolved && 'opacity-60')}>{label}</span>
        </>,
        cn(
          'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pr-1 pl-2.5',
          focusRingInset,
        ),
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Close ${label}`}
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
