'use client';

import { Building, Command, Globe, Search } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useActiveOrg } from '@/components/active-org';

import { PaletteRow } from './palette-row';
import type { PaletteItem, PaletteScope, PaletteSection } from './types';
import { filterCommands } from './filter';
import { useCommandActions } from './use-command-actions';
import { useHubSearch } from './use-hub-search';

/** The display order + heading label for each section in the list. */
const SECTION_ORDER: readonly { section: PaletteSection; label: string }[] = [
  { section: 'results', label: 'Search results' },
  { section: 'navigation', label: 'Navigate' },
  { section: 'actions', label: 'Actions' },
  { section: 'organizations', label: 'Switch workspace' },
];

/** Props for {@link CommandPalette}. */
export interface CommandPaletteProps {
  /** Whether the palette overlay is open. */
  open: boolean;
  /** Close the palette (Escape, backdrop click, or after a selection). */
  onClose: () => void;
}

/**
 * The unified Cmd/Ctrl+K command palette: search · navigate · actions · org switch.
 *
 * @remarks
 * A composed, accessible modal (no Dialog primitive exists in `@docket/ui`, so this is a
 * focus-trapped overlay built from primitives) that fuses four command kinds into one
 * keyboard-first list:
 *
 * - **Search** — debounced cross-org entity search via {@link useHubSearch}, each hit
 *   org-chipped and deep-linked into its originating org.
 * - **Navigate** — Hub destinations (Today/Inbox/Portfolio) and, in org scope, the bound
 *   org's sidebar sections.
 * - **Actions** — global actions (add organization, sign out).
 * - **Switch organization** — one command per membership.
 *
 * A **Hub-global vs org-local** segmented toggle governs whether search + navigation span
 * every org or narrow to the bound org (org-local is disabled on the Hub, where no org is
 * bound). The list is an ARIA `combobox`/`listbox`: the input keeps focus while
 * `aria-activedescendant` tracks the active row, ↑/↓ move it (wrapping), Enter runs it, and
 * Escape closes. Selecting any command closes the palette before it navigates.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps): JSX.Element | null {
  const { activeOrgId, orgName } = useActiveOrg();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<PaletteScope>('hub');
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const baseRowId = useId();

  // Reset transient state each time the palette opens, and focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    // org-local is meaningless without a bound org → fall back to hub on the Hub.
    setScope((prev) => (activeOrgId ? prev : 'hub'));
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, activeOrgId]);

  const commands = useCommandActions({ scope, close: onClose });
  const { results, loading, error, hasQuery } = useHubSearch({ query, scope, close: onClose });

  // The static (navigation/actions/org) commands matching the query.
  const staticMatches = useMemo(() => filterCommands(commands, query), [commands, query]);

  // The flat, ordered item list the keyboard navigates: search results first, then commands.
  const items = useMemo<readonly PaletteItem[]>(
    () => [...results, ...staticMatches],
    [results, staticMatches],
  );

  // Keep the active row in range as the list shrinks/grows.
  useEffect(() => {
    setActiveIndex((i) => (items.length === 0 ? 0 : Math.min(i, items.length - 1)));
  }, [items.length]);

  // Scroll the active row into view as it changes.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector('[aria-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const runActive = useCallback(() => {
    const item = items[activeIndex];
    if (item) item.run();
  }, [items, activeIndex]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
          break;
        case 'Enter':
          event.preventDefault();
          runActive();
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        case 'Tab':
          // Trap focus inside the single-input dialog.
          event.preventDefault();
          inputRef.current?.focus();
          break;
        default:
          break;
      }
    },
    [items.length, runActive, onClose],
  );

  if (!open) return null;

  /** Flat index of an item within `items`, for the row id + active marker. */
  const indexOf = (item: PaletteItem): number => items.indexOf(item);

  const grouped = SECTION_ORDER.map((s) => ({
    ...s,
    rows: items.filter((it) => it.section === s.section),
  })).filter((g) => g.rows.length > 0);

  const orgLocalLabel = activeOrgId ? orgName(activeOrgId) : 'This org';
  const showResultsSkeleton = hasQuery && loading && results.length === 0;
  const showEmpty = items.length === 0 && !showResultsSkeleton && !error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      role="presentation"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        onClick={onClose}
        className="bg-background/70 absolute inset-0 backdrop-blur-sm"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="bg-surface-container-high text-on-surface border-outline-variant animate-in fade-in-0 zoom-in-95 relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border shadow-2xl duration-150"
      >
        {/* Search input + scope toggle */}
        <div className="border-border/70 flex items-center gap-2 border-b px-3">
          <Search aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              items.length > 0 ? `${baseRowId}-${String(activeIndex)}` : undefined
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder={
              scope === 'org' ? `Search ${orgLocalLabel}…` : 'Search everything, or jump to…'
            }
            className="text-foreground placeholder:text-muted-foreground h-12 flex-1 bg-transparent text-sm outline-none"
          />
          <ScopeToggle
            scope={scope}
            orgBound={Boolean(activeOrgId)}
            orgLabel={orgLocalLabel}
            onChange={(next) => {
              setScope(next);
              setActiveIndex(0);
            }}
          />
        </div>

        {/* Results list */}
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {error ? (
            <div
              role="alert"
              className="text-destructive bg-destructive/5 border-destructive/30 m-1 rounded-md border px-3 py-2 text-sm"
            >
              {error}
            </div>
          ) : null}

          {showResultsSkeleton ? (
            <div className="flex flex-col gap-1 p-1.5" aria-hidden="true">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          ) : null}

          {showEmpty ? (
            <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
              <p className="text-foreground text-sm font-medium">No matches</p>
              <p className="text-muted-foreground max-w-xs text-sm">
                {hasQuery
                  ? 'Nothing matched your search. Try a different term or switch scope.'
                  : 'Start typing to search across your organizations.'}
              </p>
            </div>
          ) : null}

          {items.length > 0 ? (
            <ul ref={listRef} role="listbox" id={listboxId} aria-label="Commands">
              {grouped.map((group) => (
                <li key={group.section} role="presentation">
                  <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium tracking-wide uppercase">
                    {group.label}
                    {group.section === 'results' && loading ? ' · searching…' : ''}
                  </p>
                  <ul role="presentation" className="flex flex-col gap-0.5">
                    {group.rows.map((item) => {
                      const index = indexOf(item);
                      return (
                        <PaletteRow
                          key={item.id}
                          item={item}
                          active={index === activeIndex}
                          rowId={`${baseRowId}-${String(index)}`}
                          onSelect={item.run}
                          onHover={() => {
                            setActiveIndex(index);
                          }}
                        />
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Footer hint bar */}
        <div className="border-border/70 text-muted-foreground flex items-center justify-between gap-3 border-t px-3 py-2 text-[11px]">
          <span className="flex items-center gap-1.5">
            <Command aria-hidden="true" className="size-3" />K to toggle
          </span>
          <span className="flex items-center gap-3">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Props for {@link ScopeToggle}. */
interface ScopeToggleProps {
  /** The active scope. */
  scope: PaletteScope;
  /** Whether an org is bound to the current route (enables org-local). */
  orgBound: boolean;
  /** The bound org's display name (the org-local segment label). */
  orgLabel: string;
  /** Change the scope. */
  onChange: (next: PaletteScope) => void;
}

/**
 * The Hub-global vs org-local search-scope segmented control.
 *
 * @remarks
 * Two toggle segments — **Hub** (all orgs, globe glyph) and the bound org (building glyph) —
 * rendered as a small radio-style group. The org segment is disabled (and never active) when
 * no org is bound, since org-local scope is meaningless on the Hub.
 */
function ScopeToggle({ scope, orgBound, orgLabel, onChange }: ScopeToggleProps): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Search scope"
      className="border-border/70 flex shrink-0 items-center gap-0.5 rounded-md border p-0.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={scope === 'hub'}
        onClick={() => {
          onChange('hub');
        }}
        className={cn(
          'focus-visible:ring-ring flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:outline-none',
          scope === 'hub'
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Globe aria-hidden="true" className="size-3.5" />
        Hub
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={scope === 'org'}
        disabled={!orgBound}
        onClick={() => {
          onChange('org');
        }}
        title={orgBound ? undefined : 'Open an organization to search just it'}
        className={cn(
          'focus-visible:ring-ring flex max-w-[8rem] items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:opacity-40',
          scope === 'org'
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Building aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{orgBound ? orgLabel : 'This org'}</span>
      </button>
    </div>
  );
}
