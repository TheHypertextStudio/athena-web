'use client';

import {
  EntityDisplayGlyph,
  type EntityDisplayColorKey,
  type EntityDisplayOut,
} from '@docket/work/entity-display-contract';
import { Check, ChevronDown, SearchRounded } from '@docket/ui/icons';
import { loadEntityEmojiCatalog, type EntityEmojiCatalog } from '@docket/ui/icons/emoji-catalog';
import {
  clearStoredValue,
  readStoredJson,
  readStoredString,
  writeStoredJson,
  writeStoredValue,
} from '@docket/ui/lib/browser-storage';
import { cn } from '@docket/ui/lib/utils';
import {
  focusRing,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@docket/ui/primitives';
import { useVirtualizer } from '@tanstack/react-virtual';
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

import {
  emojiGlyphOptions,
  type EntityGlyphOption,
  searchGlyphOptions,
  suggestGlyphOptions,
  SYMBOL_GLYPH_OPTIONS,
} from './entity-glyph-picker-model';
import { ENTITY_DISPLAY_COLORS as COLOR_OPTIONS, EntityIconGlyph } from './entity-icon-glyph';

const GRID_COLUMNS = 7;
const GRID_ROW_HEIGHT = 42;
const GRID_MAX_HEIGHT = GRID_ROW_HEIGHT * 6;
const RECENT_LIMIT = 24;
const DEFAULT_CUSTOM_COLOR = '#3b82f6';
const SKIN_TONE_HEXCODES: Readonly<Record<string, string>> = {
  light: '1F3FB',
  'medium-light': '1F3FC',
  medium: '1F3FD',
  'medium-dark': '1F3FE',
  dark: '1F3FF',
};

/** Props for the anchored entity icon and color picker. */
export interface EntityIconPickerProps {
  display: EntityDisplayOut;
  /** Workspace used to isolate recent choices and skin-tone preference. */
  workspaceId: string;
  /** The entity's name, used for accessible copy and deterministic suggestions. */
  entityName: string;
  editable: boolean;
  pending: boolean;
  /** True while the host is reading the persisted display after this editor opens. */
  loading?: boolean;
  /** Visual glyph diameter; detail mastheads use 48dp while list surfaces keep 32dp. */
  size?: number;
  onChange: (
    glyph: EntityDisplayGlyph,
    colorKey: EntityDisplayColorKey,
    customColor: string | null,
  ) => void;
  /** Observe popover visibility so hosts can defer loading a custom display until editing starts. */
  onOpenChange?: (open: boolean) => void;
  /** Open the panel on its first mounted frame after the lightweight trigger requests this chunk. */
  initiallyOpen?: boolean;
}

/** Render one choice in a symbol or emoji grid. */
function GlyphOptionButton({
  option,
  selected,
  disabled,
  subjectType,
  colorKey,
  customColor,
  optionIndex,
  tabIndex,
  onFocus,
  onKeyDown,
  onSelect,
}: {
  readonly option: EntityGlyphOption;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly subjectType: EntityDisplayOut['subjectType'];
  readonly colorKey: EntityDisplayColorKey;
  readonly customColor: string | null;
  readonly optionIndex?: number;
  readonly tabIndex: 0 | -1;
  readonly onFocus: (index: number) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  readonly onSelect: (option: EntityGlyphOption) => void;
}): JSX.Element {
  const index = optionIndex ?? 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="entity-glyph-option"
          {...(optionIndex === undefined ? {} : { 'data-option-index': optionIndex })}
          aria-label={option.label}
          aria-pressed={selected}
          disabled={disabled}
          tabIndex={tabIndex}
          className={cn(
            'hover:bg-surface-container-highest flex size-10 shrink-0 items-center justify-center rounded-md',
            focusRing,
            selected && 'bg-surface-container-highest ring-on-surface ring-2 ring-inset',
          )}
          onFocus={() => {
            onFocus(index);
          }}
          onKeyDown={
            !onKeyDown
              ? undefined
              : (event) => {
                  onKeyDown(event, index);
                }
          }
          onClick={() => {
            onSelect(option);
          }}
        >
          <EntityIconGlyph
            subjectType={subjectType}
            glyph={option.glyph}
            colorKey={colorKey}
            customColor={customColor}
            size={32}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{option.label}</TooltipContent>
    </Tooltip>
  );
}

/** Render a short non-virtualized group for suggestions or recents. */
function StaticGlyphGrid({
  label,
  options,
  selectedGlyph,
  disabled,
  subjectType,
  colorKey,
  customColor,
  onSelect,
}: {
  readonly label: string;
  readonly options: readonly EntityGlyphOption[];
  readonly selectedGlyph: EntityDisplayGlyph;
  readonly disabled: boolean;
  readonly subjectType: EntityDisplayOut['subjectType'];
  readonly colorKey: EntityDisplayColorKey;
  readonly customColor: string | null;
  readonly onSelect: (option: EntityGlyphOption) => void;
}): JSX.Element | null {
  const gridRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex((current) => Math.max(0, Math.min(options.length - 1, current)));
  }, [options.length]);
  if (options.length === 0) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const moves: Readonly<Record<string, number>> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index - GRID_COLUMNS,
      ArrowDown: index + GRID_COLUMNS,
      Home: 0,
      End: options.length - 1,
      PageUp: index - GRID_COLUMNS * 6,
      PageDown: index + GRID_COLUMNS * 6,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const bounded = Math.max(0, Math.min(options.length - 1, next));
    setActiveIndex(bounded);
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-testid="entity-glyph-option"]',
    );
    buttons?.[bounded]?.focus();
  };

  return (
    <div role="group" aria-label={label} data-glyph-grid="">
      <p className="text-label-medium text-on-surface-variant mb-1">{label}</p>
      <div ref={gridRef} className="grid grid-cols-7 gap-0.5">
        {options.map((option, index) => (
          <GlyphOptionButton
            key={option.id}
            option={option}
            optionIndex={index}
            tabIndex={index === activeIndex ? 0 : -1}
            selected={sameGlyph(selectedGlyph, option.glyph)}
            disabled={disabled}
            subjectType={subjectType}
            colorKey={colorKey}
            customColor={customColor}
            onFocus={setActiveIndex}
            onKeyDown={handleKeyDown}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/** Render a keyboard-navigable virtualized seven-column catalog. */
function VirtualGlyphGrid({
  label,
  options,
  selectedGlyph,
  disabled,
  subjectType,
  colorKey,
  customColor,
  onSelect,
  testId,
}: {
  readonly label: string;
  readonly options: readonly EntityGlyphOption[];
  readonly selectedGlyph: EntityDisplayGlyph;
  readonly disabled: boolean;
  readonly subjectType: EntityDisplayOut['subjectType'];
  readonly colorKey: EntityDisplayColorKey;
  readonly customColor: string | null;
  readonly onSelect: (option: EntityGlyphOption) => void;
  readonly testId?: string;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const rowCount = Math.ceil(options.length / GRID_COLUMNS);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRID_ROW_HEIGHT,
    overscan: 4,
    initialRect: { width: 320, height: GRID_MAX_HEIGHT },
  });
  const measuredRows = virtualizer.getVirtualItems();
  const measuredOrInitialRows =
    measuredRows.length > 0
      ? measuredRows
      : Array.from({ length: Math.min(rowCount, 6) }, (_, index) => ({
          key: index,
          index,
          start: index * GRID_ROW_HEIGHT,
        }));
  const keyboardFocusRow =
    pendingFocusIndex === null ? null : Math.floor(pendingFocusIndex / GRID_COLUMNS);
  const visibleRows =
    keyboardFocusRow === null || measuredOrInitialRows.some((row) => row.index === keyboardFocusRow)
      ? measuredOrInitialRows
      : [
          ...measuredOrInitialRows,
          {
            key: `keyboard-${String(keyboardFocusRow)}`,
            index: keyboardFocusRow,
            start: keyboardFocusRow * GRID_ROW_HEIGHT,
          },
        ];
  const viewportHeight = Math.min(
    GRID_MAX_HEIGHT,
    Math.max(GRID_ROW_HEIGHT, rowCount * GRID_ROW_HEIGHT),
  );

  useEffect(() => {
    if (pendingFocusIndex === null) return;
    const button = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-option-index="${String(pendingFocusIndex)}"]`,
    );
    if (!button) return;
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: 'nearest' });
  }, [pendingFocusIndex]);

  useEffect(() => {
    setActiveIndex(0);
    setPendingFocusIndex(null);
  }, [options]);

  const focusIndex = useCallback(
    (index: number) => {
      const bounded = Math.max(0, Math.min(options.length - 1, index));
      setActiveIndex(bounded);
      const mounted = scrollRef.current?.querySelector<HTMLButtonElement>(
        `[data-option-index="${bounded}"]`,
      );
      if (mounted) {
        setPendingFocusIndex(null);
        mounted.focus();
        return;
      }
      setPendingFocusIndex(bounded);
      virtualizer.scrollToIndex(Math.floor(bounded / GRID_COLUMNS));
    },
    [options.length, virtualizer],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const option = options[index];
        if (option) onSelect(option);
        return;
      }
      const moves: Readonly<Record<string, number>> = {
        ArrowLeft: index - 1,
        ArrowRight: index + 1,
        ArrowUp: index - GRID_COLUMNS,
        ArrowDown: index + GRID_COLUMNS,
        Home: 0,
        End: options.length - 1,
        PageUp: index - GRID_COLUMNS * 6,
        PageDown: index + GRID_COLUMNS * 6,
      };
      const next = moves[event.key];
      if (next === undefined) return;
      event.preventDefault();
      focusIndex(next);
    },
    [focusIndex, onSelect, options],
  );

  return (
    <div role="group" aria-label={label} data-testid={testId} data-glyph-grid="">
      <div
        ref={scrollRef}
        className="overflow-y-auto overscroll-contain"
        style={{ height: viewportHeight }}
        data-virtualized-glyph-grid=""
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setActiveIndex(0);
            setPendingFocusIndex(null);
          }
        }}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {visibleRows.map((virtualRow) => {
            const start = virtualRow.index * GRID_COLUMNS;
            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 grid w-full grid-cols-7 gap-0.5"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {options.slice(start, start + GRID_COLUMNS).map((option, column) => {
                  const optionIndex = start + column;
                  return (
                    <GlyphOptionButton
                      key={option.id}
                      option={option}
                      optionIndex={optionIndex}
                      tabIndex={optionIndex === activeIndex ? 0 : -1}
                      selected={sameGlyph(selectedGlyph, option.glyph)}
                      disabled={disabled}
                      subjectType={subjectType}
                      colorKey={colorKey}
                      customColor={customColor}
                      onFocus={setActiveIndex}
                      onKeyDown={handleKeyDown}
                      onSelect={onSelect}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Render a stable entity glyph and, when editable, its anchored customization popover. */
export function LoadedEntityIconPicker({
  display,
  workspaceId,
  entityName,
  editable,
  pending,
  loading = false,
  size = 32,
  onChange,
  onOpenChange,
  initiallyOpen = false,
}: EntityIconPickerProps): JSX.Element {
  const [open, setOpen] = useState(initiallyOpen);
  const [activeTab, setActiveTab] = useState<'symbol' | 'emoji'>('symbol');
  const [search, setSearch] = useState('');
  const [emojiCatalog, setEmojiCatalog] = useState<EntityEmojiCatalog | null>(null);
  const [emojiLoadFailed, setEmojiLoadFailed] = useState(false);
  const [emojiLoadAttempt, setEmojiLoadAttempt] = useState(0);
  const [emojiGroup, setEmojiGroup] = useState<number | null>(null);
  const [skinTone, setSkinTone] = useState<string | null>(null);
  const [recents, setRecents] = useState<readonly EntityDisplayGlyph[]>([]);
  const [selectedGlyph, setSelectedGlyph] = useState(display.glyph);
  const [customColorPreview, setCustomColorPreview] = useState(
    display.customColor ?? DEFAULT_CUSTOM_COLOR,
  );
  const customColorDirty = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabSeed = useId();
  const symbolTabId = `${tabSeed}-symbols-tab`;
  const emojiTabId = `${tabSeed}-emoji-tab`;
  const tabPanelId = `${tabSeed}-panel`;
  const recentStorageKey = `docket.entity-glyph.recents.${workspaceId}`;
  const toneStorageKey = `docket.entity-glyph.skin-tone.${workspaceId}`;

  useEffect(() => {
    setSelectedGlyph(display.glyph);
    setCustomColorPreview(display.customColor ?? DEFAULT_CUSTOM_COLOR);
  }, [display.customColor, display.glyph]);

  useEffect(() => {
    const parsed = readStoredJson(recentStorageKey);
    if (Array.isArray(parsed)) {
      setRecents(
        parsed
          .map((value) => EntityDisplayGlyph.safeParse(value))
          .filter((result) => result.success)
          .map((result) => result.data)
          .slice(0, RECENT_LIMIT),
      );
    }
    const storedTone = readStoredString(toneStorageKey);
    if (storedTone && Object.values(SKIN_TONE_HEXCODES).includes(storedTone))
      setSkinTone(storedTone);
  }, [recentStorageKey, toneStorageKey]);

  useEffect(() => {
    if (!open || activeTab !== 'emoji' || emojiCatalog) return;
    let live = true;
    setEmojiLoadFailed(false);
    void loadEntityEmojiCatalog()
      .then((catalog) => {
        if (live) setEmojiCatalog(catalog);
      })
      .catch(() => {
        if (live) setEmojiLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [activeTab, emojiCatalog, emojiLoadAttempt, open, search]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const emojiOptions = useMemo(
    () => (emojiCatalog ? emojiGlyphOptions(emojiCatalog, skinTone) : []),
    [emojiCatalog, skinTone],
  );
  const visibleEmojiOptions = useMemo(() => {
    if (emojiGroup === null || !emojiCatalog) return emojiOptions;
    return emojiOptions.filter((_option, index) => emojiCatalog.emoji[index]?.group === emojiGroup);
  }, [emojiCatalog, emojiGroup, emojiOptions]);
  const query = search.trim();
  const iconResults = useMemo(
    () => (query ? searchGlyphOptions(SYMBOL_GLYPH_OPTIONS, query) : []),
    [query],
  );
  const emojiResults = useMemo(
    () => (query ? searchGlyphOptions(emojiOptions, query) : []),
    [emojiOptions, query],
  );
  const activeOptions = activeTab === 'symbol' ? SYMBOL_GLYPH_OPTIONS : visibleEmojiOptions;
  const activeSearchResults = activeTab === 'symbol' ? iconResults : emojiResults;
  const searchLabel = activeTab === 'symbol' ? 'Search icons' : 'Search emoji';
  const suggestions = useMemo(
    () => suggestGlyphOptions(activeOptions, entityName),
    [activeOptions, entityName],
  );
  const recentOptions = useMemo(
    () =>
      recents
        .map((glyph) => findGlyphOption(glyph, SYMBOL_GLYPH_OPTIONS, emojiOptions))
        .filter(isGlyphOption),
    [emojiOptions, recents],
  );

  const chooseGlyph = useCallback(
    (option: EntityGlyphOption) => {
      setSelectedGlyph(option.glyph);
      setRecents((current) => {
        const next = [
          option.glyph,
          ...current.filter((glyph) => !sameGlyph(glyph, option.glyph)),
        ].slice(0, RECENT_LIMIT);
        writeStoredJson(recentStorageKey, next);
        return next;
      });
      onChange(option.glyph, display.colorKey, display.customColor);
    },
    [display.colorKey, display.customColor, onChange, recentStorageKey],
  );

  const glyph = (
    <EntityIconGlyph
      subjectType={display.subjectType}
      glyph={display.glyph}
      colorKey={display.colorKey}
      customColor={display.customColor}
      size={size}
    />
  );
  if (!editable) {
    return (
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ width: Math.max(40, size), height: Math.max(40, size) }}
        title={entityName}
      >
        {glyph}
      </span>
    );
  }

  const disabled = pending || loading;
  const changeOpen = (next: boolean): void => {
    setOpen(next);
    if (next) setSearch('');
    onOpenChange?.(next);
  };
  const selectTab = (tab: 'symbol' | 'emoji'): void => {
    setActiveTab(tab);
    document.getElementById(tab === 'symbol' ? symbolTabId : emojiTabId)?.focus();
  };
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: 'symbol' | 'emoji',
  ): void => {
    if (event.key === 'Home') {
      event.preventDefault();
      selectTab('symbol');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      selectTab('emoji');
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    selectTab(tab === 'symbol' ? 'emoji' : 'symbol');
  };
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="hover:bg-surface-container-high focus-visible:ring-ring flex shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
          style={{ width: Math.max(40, size), height: Math.max(40, size) }}
          aria-label={`Customize ${entityName} icon`}
          disabled={pending}
        >
          {glyph}
        </button>
      </PopoverTrigger>
      <TooltipProvider delayDuration={300}>
        <PopoverContent
          presentation="panel"
          width="xl"
          maxHeight="picker"
          align="start"
          sideOffset={6}
        >
          <PopoverBody
            ref={panelRef}
            inset="none"
            scroll="hidden"
            className="flex min-h-0 flex-col"
            onKeyDownCapture={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              changeOpen(false);
              requestAnimationFrame(() => triggerRef.current?.focus());
            }}
          >
            <label
              data-testid="entity-glyph-search-header"
              className="flex h-11 shrink-0 items-center gap-2 px-4"
            >
              <SearchRounded
                aria-hidden
                className="text-on-surface-variant pointer-events-none size-4 shrink-0"
              />
              <input
                ref={searchRef}
                autoFocus
                type="search"
                aria-label={searchLabel}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown') return;
                  const firstOption = panelRef.current?.querySelector<HTMLButtonElement>(
                    '[data-glyph-grid] [data-testid="entity-glyph-option"][tabindex="0"]',
                  );
                  if (!firstOption) return;
                  event.preventDefault();
                  firstOption.focus();
                }}
                placeholder={searchLabel}
                className="placeholder:text-on-surface-variant text-on-surface text-label-large h-10 min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <div
              role="tablist"
              aria-label="Glyph catalog"
              className="flex h-10 shrink-0 gap-1 px-2"
            >
              {(['symbol', 'emoji'] as const).map((tab) => (
                <button
                  key={tab}
                  id={tab === 'symbol' ? symbolTabId : emojiTabId}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls={tabPanelId}
                  tabIndex={activeTab === tab ? 0 : -1}
                  className={cn(
                    'text-on-surface-variant hover:text-on-surface text-label-large relative min-w-0 flex-1 rounded-md px-3',
                    focusRing,
                    activeTab === tab && 'bg-surface-container-highest text-on-surface',
                  )}
                  onClick={() => {
                    setActiveTab(tab);
                  }}
                  onKeyDown={(event) => {
                    handleTabKeyDown(event, tab);
                  }}
                >
                  {tab === 'symbol' ? 'Icons' : 'Emoji'}
                </button>
              ))}
            </div>
            <div
              id={tabPanelId}
              role="tabpanel"
              aria-labelledby={activeTab === 'symbol' ? symbolTabId : emojiTabId}
              className="min-h-0 flex-1 overflow-hidden px-3 py-2"
            >
              <PickerCatalogContent
                query={query}
                activeTab={activeTab}
                activeOptions={activeOptions}
                suggestions={suggestions}
                recents={recentOptions}
                searchResults={activeSearchResults}
                emojiCatalog={emojiCatalog}
                emojiLoadFailed={emojiLoadFailed}
                emojiGroup={emojiGroup}
                skinTone={skinTone}
                selectedGlyph={selectedGlyph}
                subjectType={display.subjectType}
                colorKey={display.colorKey}
                customColor={display.customColor}
                disabled={disabled}
                onGroupChange={setEmojiGroup}
                onSkinToneChange={(tone) => {
                  setSkinTone(tone);
                  if (tone === null) clearStoredValue(toneStorageKey);
                  else writeStoredValue(toneStorageKey, tone);
                }}
                onRetryEmoji={() => {
                  setEmojiLoadAttempt((current) => current + 1);
                }}
                onSelect={chooseGlyph}
              />
            </div>
            <ColorSelector
              colorKey={display.colorKey}
              customColor={display.customColor}
              customColorPreview={customColorPreview}
              disabled={disabled}
              onPresetSelect={(colorKey) => {
                onChange(selectedGlyph, colorKey, null);
              }}
              onCustomSelect={() => {
                onChange(selectedGlyph, display.colorKey, customColorPreview);
              }}
              onCustomInput={(value) => {
                customColorDirty.current = true;
                setCustomColorPreview(value);
              }}
              onCustomCommit={() => {
                if (!customColorDirty.current) return;
                customColorDirty.current = false;
                onChange(selectedGlyph, display.colorKey, customColorPreview);
              }}
            />
          </PopoverBody>
        </PopoverContent>
      </TooltipProvider>
    </Popover>
  );
}

function PickerCatalogContent({
  query,
  activeTab,
  activeOptions,
  suggestions,
  recents,
  searchResults,
  emojiCatalog,
  emojiLoadFailed,
  emojiGroup,
  skinTone,
  selectedGlyph,
  subjectType,
  colorKey,
  customColor,
  disabled,
  onGroupChange,
  onSkinToneChange,
  onRetryEmoji,
  onSelect,
}: {
  readonly query: string;
  readonly activeTab: 'symbol' | 'emoji';
  readonly activeOptions: readonly EntityGlyphOption[];
  readonly suggestions: readonly EntityGlyphOption[];
  readonly recents: readonly EntityGlyphOption[];
  readonly searchResults: readonly EntityGlyphOption[];
  readonly emojiCatalog: EntityEmojiCatalog | null;
  readonly emojiLoadFailed: boolean;
  readonly emojiGroup: number | null;
  readonly skinTone: string | null;
  readonly selectedGlyph: EntityDisplayGlyph;
  readonly subjectType: EntityDisplayOut['subjectType'];
  readonly colorKey: EntityDisplayColorKey;
  readonly customColor: string | null;
  readonly disabled: boolean;
  readonly onGroupChange: (group: number | null) => void;
  readonly onSkinToneChange: (tone: string | null) => void;
  readonly onRetryEmoji: () => void;
  readonly onSelect: (option: EntityGlyphOption) => void;
}): JSX.Element {
  if (activeTab === 'emoji' && !emojiCatalog) {
    if (emojiLoadFailed) {
      return (
        <div
          role="alert"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-8 text-center"
        >
          <p className="text-body-medium text-on-surface-variant">Emoji could not load</p>
          <button
            type="button"
            className={cn(
              'text-primary hover:bg-surface-container-highest text-label-large h-10 rounded-md px-3',
              focusRing,
            )}
            onClick={onRetryEmoji}
          >
            Retry emoji
          </button>
        </div>
      );
    }
    return (
      <p
        role="status"
        aria-live="polite"
        className="text-body-medium text-on-surface-variant min-h-0 flex-1 py-8 text-center"
      >
        Loading emoji…
      </p>
    );
  }
  if (query) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <SearchResults
          activeTab={activeTab}
          results={searchResults}
          selectedGlyph={selectedGlyph}
          subjectType={subjectType}
          colorKey={colorKey}
          customColor={customColor}
          disabled={disabled}
          onSelect={onSelect}
        />
      </div>
    );
  }
  return (
    <BrowseCatalog
      activeTab={activeTab}
      activeOptions={activeOptions}
      suggestions={suggestions}
      recents={recents}
      emojiCatalog={emojiCatalog}
      emojiGroup={emojiGroup}
      skinTone={skinTone}
      selectedGlyph={selectedGlyph}
      subjectType={subjectType}
      colorKey={colorKey}
      customColor={customColor}
      disabled={disabled}
      onGroupChange={onGroupChange}
      onSkinToneChange={onSkinToneChange}
      onSelect={onSelect}
    />
  );
}

function BrowseCatalog({
  activeTab,
  activeOptions,
  suggestions,
  recents,
  emojiCatalog,
  emojiGroup,
  skinTone,
  selectedGlyph,
  subjectType,
  colorKey,
  customColor,
  disabled,
  onGroupChange,
  onSkinToneChange,
  onSelect,
}: {
  readonly activeTab: 'symbol' | 'emoji';
  readonly activeOptions: readonly EntityGlyphOption[];
  readonly suggestions: readonly EntityGlyphOption[];
  readonly recents: readonly EntityGlyphOption[];
  readonly emojiCatalog: EntityEmojiCatalog | null;
  readonly emojiGroup: number | null;
  readonly skinTone: string | null;
  readonly selectedGlyph: EntityDisplayGlyph;
  readonly subjectType: EntityDisplayOut['subjectType'];
  readonly colorKey: EntityDisplayColorKey;
  readonly customColor: string | null;
  readonly disabled: boolean;
  readonly onGroupChange: (group: number | null) => void;
  readonly onSkinToneChange: (tone: string | null) => void;
  readonly onSelect: (option: EntityGlyphOption) => void;
}): JSX.Element {
  const catalogLabel = activeTab === 'symbol' ? 'All icons' : 'All emoji';
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
      <div className="flex flex-col gap-3">
        {activeTab === 'emoji' && emojiCatalog ? (
          <EmojiControls
            catalog={emojiCatalog}
            group={emojiGroup}
            skinTone={skinTone}
            onGroupChange={onGroupChange}
            onSkinToneChange={onSkinToneChange}
          />
        ) : null}
        <StaticGlyphGrid
          label="Suggested"
          options={suggestions}
          selectedGlyph={selectedGlyph}
          disabled={disabled}
          subjectType={subjectType}
          colorKey={colorKey}
          customColor={customColor}
          onSelect={onSelect}
        />
        <StaticGlyphGrid
          label="Recent"
          options={recents.filter((option) => option.catalog === activeTab)}
          selectedGlyph={selectedGlyph}
          disabled={disabled}
          subjectType={subjectType}
          colorKey={colorKey}
          customColor={customColor}
          onSelect={onSelect}
        />
        <p className="text-label-medium text-on-surface-variant">{catalogLabel}</p>
        <VirtualGlyphGrid
          label={catalogLabel}
          options={activeOptions}
          selectedGlyph={selectedGlyph}
          disabled={disabled}
          subjectType={subjectType}
          colorKey={colorKey}
          customColor={customColor}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function SearchResults({
  activeTab,
  results,
  selectedGlyph,
  subjectType,
  colorKey,
  customColor,
  disabled,
  onSelect,
}: {
  readonly activeTab: 'symbol' | 'emoji';
  readonly results: readonly EntityGlyphOption[];
  readonly selectedGlyph: EntityDisplayGlyph;
  readonly subjectType: EntityDisplayOut['subjectType'];
  readonly colorKey: EntityDisplayColorKey;
  readonly customColor: string | null;
  readonly disabled: boolean;
  readonly onSelect: (option: EntityGlyphOption) => void;
}): JSX.Element {
  const catalogName = activeTab === 'symbol' ? 'icons' : 'emoji';
  const resultLabel = activeTab === 'symbol' ? 'Icon search results' : 'Emoji search results';
  if (results.length === 0) {
    return (
      <div>
        <p role="status" aria-live="polite" className="sr-only">
          0 {catalogName}
        </p>
        <p className="text-body-medium text-on-surface-variant py-8 text-center">
          No matching {catalogName}
        </p>
      </div>
    );
  }
  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {results.length} {catalogName}
      </p>
      <VirtualGlyphGrid
        label={resultLabel}
        options={results}
        selectedGlyph={selectedGlyph}
        disabled={disabled}
        subjectType={subjectType}
        colorKey={colorKey}
        customColor={customColor}
        onSelect={onSelect}
        testId={activeTab === 'symbol' ? 'icon-search-results' : 'emoji-search-results'}
      />
    </div>
  );
}

function EmojiControls({
  catalog,
  group,
  skinTone,
  onGroupChange,
  onSkinToneChange,
}: {
  readonly catalog: EntityEmojiCatalog;
  readonly group: number | null;
  readonly skinTone: string | null;
  readonly onGroupChange: (group: number | null) => void;
  readonly onSkinToneChange: (tone: string | null) => void;
}): JSX.Element {
  const toneGroupRef = useRef<HTMLDivElement>(null);
  const toneOptions = [
    { key: 'default', label: 'Default skin tone', value: null, glyph: '✋' },
    ...catalog.skinTones.flatMap((option) => {
      const tone = SKIN_TONE_HEXCODES[option.key];
      return tone
        ? [
            {
              key: option.key,
              label: capitalize(option.label),
              value: tone,
              glyph: String.fromCodePoint(0x270b, Number.parseInt(tone, 16)),
            },
          ]
        : [];
    }),
  ];
  const selectedIndex = Math.max(
    0,
    toneOptions.findIndex((option) => option.value === skinTone),
  );
  return (
    <div className="flex flex-col gap-2">
      <label className="text-label-medium text-on-surface-variant flex items-center justify-between gap-2">
        Category
        <select
          aria-label="Emoji category"
          value={group ?? ''}
          className="border-outline bg-surface h-10 min-w-0 flex-1 rounded-md border px-2"
          onChange={(event) => {
            onGroupChange(event.target.value === '' ? null : Number(event.target.value));
          }}
        >
          <option value="">All emoji</option>
          {catalog.groups.map((option) => (
            <option key={option.order} value={option.order}>
              {capitalize(option.label)}
            </option>
          ))}
        </select>
      </label>
      <div
        ref={toneGroupRef}
        role="radiogroup"
        aria-label="Skin tone"
        className="flex gap-1 overflow-x-auto"
      >
        {toneOptions.map((option, index) => {
          const selected = index === selectedIndex;
          return (
            <Tooltip key={option.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-label={option.label}
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  className={cn(
                    'hover:bg-surface-container-highest text-title-medium flex size-10 shrink-0 items-center justify-center rounded-md',
                    focusRing,
                    selected && 'bg-surface-container-highest ring-on-surface ring-2 ring-inset',
                  )}
                  onKeyDown={(event) => {
                    const next = nextRadioIndex(event.key, index, toneOptions.length);
                    if (next === null) return;
                    event.preventDefault();
                    const nextOption = toneOptions[next];
                    if (!nextOption) return;
                    onSkinToneChange(nextOption.value);
                    focusRadio(toneGroupRef.current, next);
                  }}
                  onClick={() => {
                    onSkinToneChange(option.value);
                  }}
                >
                  <span aria-hidden>{option.glyph}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function ColorSelector({
  colorKey,
  customColor,
  customColorPreview,
  disabled,
  onPresetSelect,
  onCustomSelect,
  onCustomInput,
  onCustomCommit,
}: {
  readonly colorKey: EntityDisplayColorKey;
  readonly customColor: string | null;
  readonly customColorPreview: string;
  readonly disabled: boolean;
  readonly onPresetSelect: (colorKey: EntityDisplayColorKey) => void;
  readonly onCustomSelect: () => void;
  readonly onCustomInput: (value: string) => void;
  readonly onCustomCommit: () => void;
}): JSX.Element {
  const groupRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const customIndex = COLOR_OPTIONS.length;
  const selectedIndex =
    customColor === null
      ? Math.max(
          0,
          COLOR_OPTIONS.findIndex((option) => option.key === colorKey),
        )
      : customIndex;
  const selectedColor = COLOR_OPTIONS[selectedIndex];
  const selectedLabel = customColor === null ? (selectedColor?.label ?? 'Color') : 'Custom';
  const selectIndex = (index: number): void => {
    const option = COLOR_OPTIONS[index];
    if (option) onPresetSelect(option.key);
    else if (index === customIndex) onCustomSelect();
  };
  return (
    <Popover>
      <div
        data-testid="entity-glyph-color-footer"
        className="bg-surface-container-low flex h-12 shrink-0 items-center justify-between px-3"
      >
        <span className="text-label-medium text-on-surface-variant">Color</span>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Choose color, ${selectedLabel}`}
            disabled={disabled}
            className={cn(
              'hover:bg-surface-container-highest text-label-large flex h-10 min-w-28 items-center gap-2 rounded-md px-2',
              focusRing,
            )}
          >
            <span
              aria-hidden
              className={cn(
                'ring-outline size-5 rounded-full ring-1',
                customColor === null && selectedColor?.swatchClass,
              )}
              style={customColor === null ? undefined : { backgroundColor: customColorPreview }}
            />
            <span className="min-w-0 flex-1 text-left">{selectedLabel}</span>
            <ChevronDown aria-hidden className="text-on-surface-variant size-4" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        presentation="panel"
        width="sm"
        align="end"
        side="top"
        sideOffset={6}
        aria-label="Entity color picker"
      >
        <PopoverBody inset="compact" scroll="visible">
          <p className="text-label-medium text-on-surface-variant mb-1">Color</p>
          <div
            ref={groupRef}
            role="radiogroup"
            aria-label="Entity color"
            className="grid grid-cols-4 gap-1"
          >
            {COLOR_OPTIONS.map((option, index) => {
              const selected = index === selectedIndex;
              return (
                <Tooltip key={option.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      role="radio"
                      aria-label={option.label}
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      disabled={disabled}
                      className={cn(
                        'hover:bg-surface-container-highest relative flex size-10 shrink-0 items-center justify-center rounded-md',
                        focusRing,
                        selected &&
                          'bg-surface-container-highest ring-on-surface ring-2 ring-inset',
                      )}
                      onKeyDown={(event) => {
                        const next = nextRadioIndex(event.key, index, COLOR_OPTIONS.length + 1);
                        if (next === null) return;
                        event.preventDefault();
                        selectIndex(next);
                        focusRadio(groupRef.current, next);
                      }}
                      onClick={() => {
                        onPresetSelect(option.key);
                      }}
                    >
                      <span aria-hidden className={cn('size-5 rounded-full', option.swatchClass)} />
                      {selected ? <SelectedRadioIndicator /> : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{option.label}</TooltipContent>
                </Tooltip>
              );
            })}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-label="Custom color"
                  aria-checked={selectedIndex === customIndex}
                  tabIndex={selectedIndex === customIndex ? 0 : -1}
                  disabled={disabled}
                  className={cn(
                    'hover:bg-surface-container-highest relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md',
                    focusRing,
                    selectedIndex === customIndex &&
                      'bg-surface-container-highest ring-on-surface ring-2 ring-inset',
                  )}
                  onKeyDown={(event) => {
                    const next = nextRadioIndex(event.key, customIndex, COLOR_OPTIONS.length + 1);
                    if (next !== null) {
                      event.preventDefault();
                      selectIndex(next);
                      focusRadio(groupRef.current, next);
                      return;
                    }
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    customInputRef.current?.click();
                  }}
                  onClick={() => {
                    customInputRef.current?.click();
                  }}
                >
                  <span
                    aria-hidden
                    className="ring-outline size-5 rounded-full ring-1"
                    style={{ backgroundColor: customColorPreview }}
                  />
                  {selectedIndex === customIndex ? <SelectedRadioIndicator /> : null}
                </button>
              </TooltipTrigger>
              <TooltipContent>Custom color</TooltipContent>
            </Tooltip>
            <input
              ref={customInputRef}
              type="color"
              aria-label="Custom color value"
              value={customColorPreview}
              disabled={disabled}
              tabIndex={-1}
              onInput={(event) => {
                onCustomInput(event.currentTarget.value);
              }}
              onBlur={onCustomCommit}
              className="pointer-events-none absolute size-px opacity-0"
            />
          </div>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

function SelectedRadioIndicator(): JSX.Element {
  return (
    <span
      data-testid="selected-radio-indicator"
      aria-hidden
      className="bg-surface text-on-surface absolute right-0.5 bottom-0.5 flex size-3 items-center justify-center rounded-full"
    >
      <Check className="size-2.5" />
    </span>
  );
}

function nextRadioIndex(key: string, index: number, count: number): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  return null;
}

function focusRadio(group: HTMLDivElement | null, index: number): void {
  requestAnimationFrame(() => {
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  });
}

function findGlyphOption(
  glyph: EntityDisplayGlyph,
  symbols: readonly EntityGlyphOption[],
  emoji: readonly EntityGlyphOption[],
): EntityGlyphOption | undefined {
  return [...symbols, ...emoji].find((option) => sameGlyph(option.glyph, glyph));
}

function isGlyphOption(option: EntityGlyphOption | undefined): option is EntityGlyphOption {
  return option !== undefined;
}

function sameGlyph(left: EntityDisplayGlyph, right: EntityDisplayGlyph): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === 'symbol'
    ? left.name === (right.kind === 'symbol' ? right.name : '')
    : left.hexcode === (right.kind === 'emoji' ? right.hexcode : '');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default LoadedEntityIconPicker;
