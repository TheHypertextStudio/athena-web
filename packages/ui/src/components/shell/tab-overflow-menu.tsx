'use client';

import * as React from 'react';

import { ChevronDown, Search, X } from '../../icons';
import { cn } from '../../lib/utils';
import {
  CONTROL,
  fieldSurface,
  menuFocusRing,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../primitives';

import { MenuActionRow } from '../menus/MenuActionRow';

import type { OpenTab, TabRenderLink } from './tab-types';
import { TYPE_ICON, tabLabel } from './tab-types';

interface OverflowMenuProps {
  readonly tabs: readonly OpenTab[];
  readonly activeKey?: string | undefined;
  readonly renderLink: TabRenderLink;
  readonly onClose: (key: string) => void;
}

/** Return whether a keydown is the cross-platform open-document switcher shortcut. */
function isOpenDocumentsShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    !event.repeat &&
    event.key.toLowerCase() === 'a'
  );
}

/** OverflowMenu renders the shell's searchable open-document switcher. */
export function OverflowMenu({
  tabs,
  activeKey,
  renderLink,
  onClose,
}: OverflowMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [shortcutLabel, setShortcutLabel] = React.useState('Ctrl ⇧ A');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const pendingCloseIndexRef = React.useRef<number | null>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredTabs = React.useMemo(
    () =>
      normalizedQuery.length === 0
        ? tabs
        : tabs.filter((tab) => tabLabel(tab).toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery, tabs],
  );

  const resultLinks = React.useCallback((): HTMLAnchorElement[] => {
    const rows = contentRef.current?.querySelectorAll<HTMLElement>('[data-menu-action-row]') ?? [];
    return Array.from(rows).flatMap((row) => {
      const link = row.querySelector<HTMLAnchorElement>('a[href]');
      return link ? [link] : [];
    });
  }, []);

  React.useEffect(() => {
    setShortcutLabel(/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘ ⇧ A' : 'Ctrl ⇧ A');
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isOpenDocumentsShortcut(event)) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  React.useLayoutEffect(() => {
    const pendingIndex = pendingCloseIndexRef.current;
    if (pendingIndex === null) return;
    pendingCloseIndexRef.current = null;
    const links = resultLinks();
    const target = links[Math.min(pendingIndex, links.length - 1)];
    if (target) target.focus();
    else searchRef.current?.focus();
  }, [filteredTabs, resultLinks, tabs]);

  const handleOpenChange = React.useCallback((nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery('');
  }, []);

  const handleContentKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleOpenChange(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const links = resultLinks();
      if (links.length === 0) return;
      event.preventDefault();

      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const target = event.target instanceof Element ? event.target : null;
      const currentRow = target?.closest<HTMLElement>('[data-menu-action-row]') ?? null;
      const currentLink = currentRow?.querySelector<HTMLAnchorElement>('a[href]') ?? null;
      const currentIndex = currentLink ? links.indexOf(currentLink) : -1;
      const nextIndex =
        currentIndex === -1
          ? direction === 1
            ? 0
            : links.length - 1
          : (currentIndex + direction + links.length) % links.length;
      links[nextIndex]?.focus();
    },
    [handleOpenChange, resultLinks],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger
            ref={triggerRef}
            type="button"
            aria-label={`Open documents (${String(tabs.length)})`}
            className={cn(
              'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface data-[state=open]:bg-surface-container-highest data-[state=open]:text-on-surface text-label-medium flex h-8 shrink-0 items-center gap-0.5 self-center rounded-md px-2 transition-colors',
              menuFocusRing,
            )}
          >
            <span className="tabular-nums">{tabs.length}</span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>All open documents</TooltipContent>
      </Tooltip>

      <PopoverContent
        ref={contentRef}
        role="dialog"
        aria-label="Open documents"
        align="end"
        className="w-88 p-2 lg:w-[min(480px,calc(100vw-1.5rem))]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        onKeyDown={handleContentKeyDown}
      >
        <div
          className={cn(
            fieldSurface({ variant: 'filled', controlSize: 'lg', ringOn: 'within' }),
            CONTROL.lg.gap,
            'flex items-center',
          )}
        >
          <Search aria-hidden="true" className={cn(CONTROL.lg.icon, 'text-on-surface-variant')} />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search open documents"
            placeholder="Search open documents"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            className="placeholder:text-on-surface-variant min-w-0 flex-1 bg-transparent outline-none"
          />
          <kbd
            aria-hidden="true"
            className="text-on-surface-variant text-label-small shrink-0 tabular-nums"
          >
            {shortcutLabel}
          </kbd>
        </div>

        {filteredTabs.length === 0 ? (
          <p className="text-on-surface-variant text-body-small px-4 py-3">
            No open documents found
          </p>
        ) : (
          <div
            role="list"
            aria-label="Open document results"
            className="flex max-h-80 flex-col gap-0.5 overflow-y-auto overscroll-contain"
          >
            {filteredTabs.map((tab, index) => {
              const Icon = TYPE_ICON[tab.type];
              const active = tab.key === activeKey;
              return (
                <MenuActionRow
                  key={tab.key}
                  label={tabLabel(tab)}
                  leading={<Icon aria-hidden="true" />}
                  selected={active}
                  renderPrimary={(children, className) => renderLink(tab.href, children, className)}
                  actionLabel={`Close ${tabLabel(tab)}`}
                  actionIcon={<X aria-hidden="true" />}
                  onPrimarySelect={() => {
                    handleOpenChange(false);
                  }}
                  onAction={() => {
                    pendingCloseIndexRef.current = index;
                    onClose(tab.key);
                  }}
                />
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
