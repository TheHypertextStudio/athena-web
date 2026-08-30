'use client';

import { Command, Search, Tag, X } from '@docket/ui/icons';
import { MenuListbox, MenuSectionLabel } from '@docket/ui/components';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@docket/ui/primitives';
import {
  Fragment,
  type JSX,
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
import { ScopeToggle } from './scope-toggle';
import { usePaletteKeyboard } from './use-palette-keyboard';
import { filterCommands } from './filter';
import { mergePaletteResults } from './merge-results';
import { useCapabilityItems } from './use-capability-items';
import { useCommandActions } from './use-command-actions';
import { useHubSearch } from './use-hub-search';
import { PALETTE_MODES, parsePrefix, useLabelPaletteMode } from './sub-modes';

/** The display order + heading label for each section in the list. */
const SECTION_ORDER: readonly { section: PaletteSection; label: string }[] = [
  { section: 'results', label: 'Best matches' },
  { section: 'navigation', label: 'Navigate' },
  { section: 'actions', label: 'Actions' },
  { section: 'panels', label: 'Panels' },
  { section: 'templates', label: 'Create from template' },
  { section: 'organizations', label: 'Switch workspace' },
];

/** Props for {@link CommandPalette}. */
export interface CommandPaletteProps {
  /** Whether the palette overlay is open. */
  open: boolean;
  /** Close the palette (Escape, backdrop click, or after a selection). */
  onClose: () => void;
  /** Whether the current route hosts the persistent utility rail. */
  panelsAvailable?: boolean;
  /** Ask the shell to reveal one of its persistent utility panels. */
  onOpenPanel?: (panelId: 'agenda' | 'focus' | 'athena') => void;
  /** Account id captured by the shell for destructive session commands. */
  sessionOwnerUserId: string | null;
}

const IGNORE_PANEL_REQUEST = (): undefined => undefined;

/**
 * The unified Cmd/Ctrl+K command palette: search · navigate · actions · org switch.
 *
 * @remarks
 * A shared accessible dialog that fuses four command kinds into one keyboard-first list:
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
export function CommandPalette({
  open,
  onClose,
  panelsAvailable = true,
  onOpenPanel = IGNORE_PANEL_REQUEST,
  sessionOwnerUserId,
}: CommandPaletteProps): JSX.Element | null {
  const { activeOrgId, orgName } = useActiveOrg();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<PaletteScope>('hub');
  const [activeId, setActiveId] = useState<string | null>(null);

  const { mode, term } = useMemo(() => parsePrefix(query), [query]);
  // Gate each mode's own query on the palette actually being open and in that mode -- mirroring
  // how useHubSearch is gated (`open && mode === null`) just below -- since CommandPalette is
  // mounted unconditionally by the app shell and only early-returns `null` below its hooks.
  const labelModeResult = useLabelPaletteMode(term, {
    activeOrgId,
    close: onClose,
    enabled: open && mode === '#',
  });
  const modeResult = mode === '#' ? labelModeResult : null;

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // A dismissal returns to the opener. A selected command owns the next focus destination, so
  // restoring the opener would race routed heading focus and newly opened panels or dialogs.
  const restoreFocusOnCloseRef = useRef(true);
  // Latest `activeOrgId`, read by the open effect without making it a dependency (so an org
  // change mid-session does not re-run the open effect and refocus the input).
  const activeOrgIdRef = useRef(activeOrgId);
  activeOrgIdRef.current = activeOrgId;
  const listboxId = useId();
  const baseRowId = useId();

  // Reset transient state each time the palette opens and move focus to the input.
  // Keyed only on `open` so an `activeOrgId` change mid-session never re-runs this and steals
  // focus back to the input; the scope fallback below reads `activeOrgId` without depending on it.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveId(null);
    restoreFocusOnCloseRef.current = true;
    // org-local is meaningless without a bound org → fall back to hub on the Hub.
    setScope((prev) => (activeOrgIdRef.current ? prev : 'hub'));
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const commands = useCommandActions({ open, close: onClose });
  const capabilities = useCapabilityItems({
    open,
    close: onClose,
    panelsAvailable,
    onOpenPanel,
    sessionOwnerUserId,
  });
  const { results, loading, error, hasQuery } = useHubSearch({
    query,
    scope,
    close: onClose,
    open: open && mode === null,
  });

  // The static (navigation/actions/org) commands matching the query — suppressed while a mode is
  // active, since a mode's own item list takes over the list entirely.
  const staticMatches = useMemo(
    () => (mode !== null ? [] : filterCommands([...capabilities, ...commands], query)),
    [mode, capabilities, commands, query],
  );

  // The flat, ordered item list the keyboard navigates: search results first, then commands, or —
  // while a mode is active — that mode's own items instead.
  const items = useMemo<readonly PaletteItem[]>(
    () =>
      modeResult
        ? modeResult.items
        : query.trim().length > 0
          ? mergePaletteResults(staticMatches, results, query)
          : [...results, ...staticMatches],
    [modeResult, query, results, staticMatches],
  );

  // Preserve the active result by id while asynchronous sources reorder the list.
  useEffect(() => {
    if (items.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (activeId === null || !items.some((item) => item.id === activeId)) {
      setActiveId(items[0]?.id ?? null);
    }
  }, [activeId, items]);

  const activeIndex = useMemo(
    () =>
      Math.max(
        0,
        items.findIndex((item) => item.id === activeId),
      ),
    [activeId, items],
  );

  // Scroll the active row into view as it changes.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector('[aria-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeId, open]);

  // Escape exits a mode before it closes the palette — a mode is a state to back out of, not
  // just query text — so the keyboard hook's `onClose` gets a wrapper instead of `onClose` itself.
  const handlePaletteClose = useCallback(() => {
    if (mode !== null) {
      setQuery('');
      return;
    }
    onClose();
  }, [mode, onClose]);

  const runItem = useCallback((item: PaletteItem) => {
    restoreFocusOnCloseRef.current = false;
    item.run();
  }, []);

  const { onKeyDown } = usePaletteKeyboard({
    items,
    activeId,
    setActiveId,
    runItem,
    onClose: handlePaletteClose,
  });

  if (!open) return null;

  /** Flat index of an item within `items`, for the row id + active marker. */
  const indexOf = (item: PaletteItem): number => items.indexOf(item);

  const grouped = SECTION_ORDER.map((s) => ({
    ...s,
    // With an empty box these rows are recents, not matches, and calling them "Search results"
    // would misdescribe what the reader is looking at. While a mode is active, the results
    // section is relabeled to the mode's own name (e.g. "Labels") instead.
    label:
      mode !== null && s.section === 'results'
        ? (PALETTE_MODES[mode]?.label ?? s.label)
        : s.section === 'results' && !hasQuery
          ? 'Recent'
          : s.label,
    rows: items.filter((it) => it.section === s.section),
  })).filter((g) => g.rows.length > 0);

  const orgLocalLabel = activeOrgId ? orgName(activeOrgId) : 'This org';
  const effectiveError = modeResult ? modeResult.error : error;
  const showNoOrgForMode = mode !== null && activeOrgId === null;
  const showResultsSkeleton = modeResult
    ? modeResult.loading && modeResult.items.length === 0
    : loading && items.length === 0;
  const showEmpty =
    !showNoOrgForMode && items.length === 0 && !showResultsSkeleton && !effectiveError;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        presentation={{ kind: 'top', size: 'large', height: 'tall' }}
        showClose={false}
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusOnCloseRef.current) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (mode === null) return;
          event.preventDefault();
          setQuery('');
        }}
      >
        {/* Search input + scope toggle */}
        <DialogHeader
          inset="compact"
          className="border-outline-variant flex-row items-center gap-3 border-b"
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          {mode !== null ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="text-on-surface-variant hover:text-on-surface text-label-large flex shrink-0 items-center gap-1"
              aria-label={`Exit ${PALETTE_MODES[mode]?.label ?? 'filter'}`}
            >
              <Tag aria-hidden="true" className="size-4" />
              {PALETTE_MODES[mode]?.label}
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : (
            <Search aria-hidden="true" className="text-on-surface-variant size-5 shrink-0" />
          )}
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
              setActiveId(null);
            }}
            placeholder={
              mode !== null
                ? `Filter ${(PALETTE_MODES[mode]?.label ?? '').toLowerCase()}…`
                : scope === 'org'
                  ? `Search ${orgLocalLabel}…`
                  : 'Search everything, or jump to…'
            }
            className="text-on-surface placeholder:text-on-surface-variant text-label-large h-12 flex-1 bg-transparent outline-none"
          />
          <ScopeToggle
            scope={scope}
            orgBound={Boolean(activeOrgId)}
            orgLabel={orgLocalLabel}
            onChange={(next) => {
              setScope(next);
              setActiveId(null);
            }}
          />
        </DialogHeader>

        {/* Results list */}
        <DialogBody inset="compact" className="flex flex-col gap-1">
          {effectiveError ? (
            <div
              role="alert"
              className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
            >
              {effectiveError}
            </div>
          ) : null}

          {showNoOrgForMode ? (
            <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
              <p className="text-on-surface-variant text-body-medium">
                {/* `mode` is non-null here — `showNoOrgForMode`'s initializer conjuncts
                    `mode !== null`, and TS's aliased-condition narrowing carries that into this
                    branch, so an `?? ''` fallback would be flagged as statically unreachable. */}
                Open a workspace to filter by {(PALETTE_MODES[mode]?.label ?? 'this').toLowerCase()}
              </p>
            </div>
          ) : null}

          {/* placeholder: the search results for what has been typed — how many match and what
              each one is. Only the results region: the input, the static command actions and the
              "No matches" copy are all available without a fetch. */}
          {showResultsSkeleton ? (
            <div className="flex flex-col gap-1 p-1.5" aria-hidden="true">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          ) : null}

          {showEmpty ? (
            <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
              <p className="text-on-surface text-body-medium font-medium">No matches</p>
              <p className="text-on-surface-variant text-body-medium max-w-xs">
                {mode !== null
                  ? 'No labels match.'
                  : hasQuery
                    ? 'Nothing matched your search. Try a different term or switch scope.'
                    : 'Nothing here yet. Create some work, or link a document, and it will show up.'}
              </p>
            </div>
          ) : null}

          {items.length > 0 ? (
            <MenuListbox ref={listRef} id={listboxId} ariaLabel="Commands">
              {grouped.map((group) => (
                <Fragment key={group.section}>
                  <MenuSectionLabel>
                    {group.label}
                    {group.section === 'results' && (modeResult ? modeResult.loading : loading)
                      ? ` · ${mode !== null ? 'loading…' : 'searching…'}`
                      : ''}
                  </MenuSectionLabel>
                  <ul role="presentation" className="flex flex-col gap-0.5">
                    {group.rows.map((item) => {
                      const index = indexOf(item);
                      return (
                        <PaletteRow
                          key={item.id}
                          item={item}
                          active={item.id === activeId}
                          rowId={`${baseRowId}-${String(index)}`}
                          onSelect={() => {
                            runItem(item);
                          }}
                          onHover={() => {
                            setActiveId(item.id);
                          }}
                        />
                      );
                    })}
                  </ul>
                </Fragment>
              ))}
            </MenuListbox>
          ) : null}
        </DialogBody>

        {/* Footer hint bar */}
        <DialogFooter
          inset="compact"
          className="border-outline-variant flex-row justify-between gap-3 border-t sm:justify-between"
        >
          <span className="flex items-center gap-1.5">
            <Command aria-hidden="true" className="size-5" />K to toggle
          </span>
          <span className="flex items-center gap-3">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
