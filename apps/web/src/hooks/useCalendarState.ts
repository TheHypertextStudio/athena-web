'use client';

import { useState, useCallback, type MouseEvent } from 'react';
import type { CalendarEntry, LinkedTask } from '@/components/objects/surfaces/DayCalendar';

// =============================================================================
// Types
// =============================================================================

export interface CalendarDialogState {
  open: boolean;
  startTime: Date;
  endTime: Date;
  anchorRect: DOMRect | null;
}

export interface PreviewEntry {
  startTime: Date;
  endTime: Date;
}

export interface CalendarContextMenuState {
  entry: CalendarEntry | null;
  position: { x: number; y: number } | null;
}

export interface CalendarDetailPopoverState {
  open: boolean;
  entry: CalendarEntry | null;
  anchorRect: DOMRect | null;
}

export interface CalendarMutationCallbacks {
  /** Called when creating an entry (async) */
  onCreateEntry?: (entry: Omit<CalendarEntry, 'id'>) => Promise<void>;
  /** Called when updating an entry (async) */
  onUpdateEntry?: (
    entryId: string,
    updates: Partial<CalendarEntry>,
    type: 'event' | 'time-block',
  ) => Promise<void>;
  /** Called when deleting an entry (async) */
  onDeleteEntry?: (entryId: string, type: 'event' | 'time-block') => Promise<void>;
  /** Called when moving an entry (async) */
  onMoveEntry?: (
    entryId: string,
    newStart: Date,
    newEnd: Date,
    type: 'event' | 'time-block',
  ) => Promise<void>;
  /** Called when resizing an entry (async) */
  onResizeEntry?: (
    entryId: string,
    newStart: Date,
    newEnd: Date,
    type: 'event' | 'time-block',
  ) => Promise<void>;
}

export interface UseCalendarStateOptions {
  /** Initial date (defaults to today) */
  initialDate?: Date;
  /** Entries to display (controlled mode) */
  entries?: CalendarEntry[];
  /** Mutation callbacks for backend persistence */
  mutations?: CalendarMutationCallbacks;
}

export interface UseCalendarStateReturn {
  // State
  date: Date;
  entries: CalendarEntry[];
  creationDialog: CalendarDialogState;
  detailPopover: CalendarDetailPopoverState;
  contextMenu: CalendarContextMenuState;
  previewEntry: PreviewEntry | null;

  // Date navigation
  setDate: (date: Date) => void;
  goToToday: () => void;

  // Entry CRUD
  createEntry: (entry: Omit<CalendarEntry, 'id'>) => void;
  updateEntry: (entryId: string, updates: Partial<CalendarEntry>) => void;
  deleteEntry: (entryId: string) => void;
  duplicateEntry: (entry: CalendarEntry) => void;
  moveEntry: (entryId: string, newStart: Date, newEnd: Date) => void;
  resizeEntry: (entryId: string, newStart: Date, newEnd: Date) => void;

  // Dialog handlers
  openCreationDialog: (startTime: Date, endTime: Date, anchorRect?: DOMRect) => void;
  closeCreationDialog: () => void;
  setCreationDialogOpen: (open: boolean) => void;
  movePreview: (newStart: Date, newEnd: Date) => void;

  // Detail popover handlers
  openDetailPopover: (entry: CalendarEntry, anchorRect: DOMRect) => void;
  closeDetailPopover: () => void;

  // Context menu handlers
  openContextMenu: (entry: CalendarEntry, event: MouseEvent) => void;
  closeContextMenu: () => void;

  // Event handlers (for passing to DayCalendar)
  handlers: {
    onDateChange: (date: Date) => void;
    onCreateSelection: (start: Date, end: Date, anchorRect: DOMRect) => void;
    onEntryClick: (entry: CalendarEntry, event: MouseEvent) => void;
    onEntryContextMenu: (entry: CalendarEntry, event: MouseEvent) => void;
    onEntryMove: (entryId: string, newStart: Date, newEnd: Date) => void;
    onEntryResize: (entryId: string, newStart: Date, newEnd: Date) => void;
    onPreviewMove: (newStart: Date, newEnd: Date) => void;
    onTaskClick: (task: LinkedTask, entry: CalendarEntry, event: MouseEvent) => void;
  };
}

// =============================================================================
// Helper
// =============================================================================

function getTodayDate(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function generateId(): string {
  return `entry-${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`;
}

// =============================================================================
// Hook
// =============================================================================

export function useCalendarState(options: UseCalendarStateOptions = {}): UseCalendarStateReturn {
  const { initialDate, entries: externalEntries, mutations } = options;

  // Core state
  const [date, setDate] = useState<Date>(() => initialDate ?? getTodayDate());
  const [localEntries, setLocalEntries] = useState<CalendarEntry[]>([]);

  // Use external entries if provided, otherwise use local state
  const entries = externalEntries ?? localEntries;

  // Dialog state
  const [creationDialog, setCreationDialog] = useState<CalendarDialogState>({
    open: false,
    startTime: new Date(),
    endTime: new Date(),
    anchorRect: null,
  });

  // Context menu state
  const [contextMenu, setContextMenu] = useState<CalendarContextMenuState>({
    entry: null,
    position: null,
  });

  // Preview entry (shown on calendar while creating)
  const [previewEntry, setPreviewEntry] = useState<PreviewEntry | null>(null);

  // Detail popover state
  const [detailPopover, setDetailPopover] = useState<CalendarDetailPopoverState>({
    open: false,
    entry: null,
    anchorRect: null,
  });

  // =============================================================================
  // Date navigation
  // =============================================================================

  const goToToday = useCallback(() => {
    setDate(getTodayDate());
  }, []);

  // =============================================================================
  // Entry CRUD
  // =============================================================================

  // Helper to find entry type
  const getEntryType = useCallback(
    (entryId: string): 'event' | 'time-block' => {
      const entry = entries.find((e) => e.id === entryId);
      return entry?.type ?? 'event';
    },
    [entries],
  );

  const createEntry = useCallback(
    (entry: Omit<CalendarEntry, 'id'>) => {
      if (mutations?.onCreateEntry) {
        void mutations.onCreateEntry(entry);
      } else {
        // Fallback to local state
        const newEntry: CalendarEntry = {
          ...entry,
          id: generateId(),
        };
        setLocalEntries((prev) => [...prev, newEntry]);
      }
    },
    [mutations],
  );

  const updateEntry = useCallback(
    (entryId: string, updates: Partial<CalendarEntry>) => {
      const type = getEntryType(entryId);
      if (mutations?.onUpdateEntry) {
        void mutations.onUpdateEntry(entryId, updates, type);
      } else {
        setLocalEntries((prev) =>
          prev.map((entry) => (entry.id === entryId ? { ...entry, ...updates } : entry)),
        );
      }
    },
    [mutations, getEntryType],
  );

  const deleteEntry = useCallback(
    (entryId: string) => {
      const type = getEntryType(entryId);
      if (mutations?.onDeleteEntry) {
        void mutations.onDeleteEntry(entryId, type);
      } else {
        setLocalEntries((prev) => prev.filter((entry) => entry.id !== entryId));
      }
    },
    [mutations, getEntryType],
  );

  const duplicateEntry = useCallback(
    (entry: CalendarEntry) => {
      const duplicate: Omit<CalendarEntry, 'id'> = {
        ...entry,
        title: `${entry.title} (copy)`,
      };
      createEntry(duplicate);
    },
    [createEntry],
  );

  const moveEntry = useCallback(
    (entryId: string, newStart: Date, newEnd: Date) => {
      const type = getEntryType(entryId);
      if (mutations?.onMoveEntry) {
        void mutations.onMoveEntry(entryId, newStart, newEnd, type);
      } else {
        setLocalEntries((prev) =>
          prev.map((entry) =>
            entry.id === entryId ? { ...entry, startTime: newStart, endTime: newEnd } : entry,
          ),
        );
      }
    },
    [mutations, getEntryType],
  );

  const resizeEntry = useCallback(
    (entryId: string, newStart: Date, newEnd: Date) => {
      const type = getEntryType(entryId);
      if (mutations?.onResizeEntry) {
        void mutations.onResizeEntry(entryId, newStart, newEnd, type);
      } else {
        setLocalEntries((prev) =>
          prev.map((entry) =>
            entry.id === entryId ? { ...entry, startTime: newStart, endTime: newEnd } : entry,
          ),
        );
      }
    },
    [mutations, getEntryType],
  );

  // =============================================================================
  // Dialog handlers
  // =============================================================================

  const openCreationDialog = useCallback((startTime: Date, endTime: Date, anchorRect?: DOMRect) => {
    setCreationDialog({ open: true, startTime, endTime, anchorRect: anchorRect ?? null });
    setPreviewEntry({ startTime, endTime });
  }, []);

  const closeCreationDialog = useCallback(() => {
    setCreationDialog((prev) => ({ ...prev, open: false, anchorRect: null }));
    setPreviewEntry(null);
  }, []);

  const setCreationDialogOpen = useCallback((open: boolean) => {
    setCreationDialog((prev) => ({ ...prev, open }));
    if (!open) {
      setPreviewEntry(null);
    }
  }, []);

  const movePreview = useCallback((newStart: Date, newEnd: Date) => {
    setPreviewEntry({ startTime: newStart, endTime: newEnd });
    setCreationDialog((prev) => ({
      ...prev,
      startTime: newStart,
      endTime: newEnd,
    }));
  }, []);

  // =============================================================================
  // Context menu handlers
  // =============================================================================

  const openContextMenu = useCallback((entry: CalendarEntry, event: MouseEvent) => {
    setContextMenu({
      entry,
      position: { x: event.clientX, y: event.clientY },
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu({ entry: null, position: null });
  }, []);

  // =============================================================================
  // Detail popover handlers
  // =============================================================================

  const openDetailPopover = useCallback((entry: CalendarEntry, anchorRect: DOMRect) => {
    setDetailPopover({ open: true, entry, anchorRect });
  }, []);

  const closeDetailPopover = useCallback(() => {
    setDetailPopover({ open: false, entry: null, anchorRect: null });
  }, []);

  // =============================================================================
  // Event handlers for DayCalendar
  // =============================================================================

  const handleEntryClick = useCallback(
    (entry: CalendarEntry, event: MouseEvent) => {
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      openDetailPopover(entry, rect);
    },
    [openDetailPopover],
  );

  const handleTaskClick = useCallback(
    (task: LinkedTask, entry: CalendarEntry, _event: MouseEvent) => {
      console.log('Task clicked:', task.title, 'in entry:', entry.title);
    },
    [],
  );

  // =============================================================================
  // Return
  // =============================================================================

  return {
    // State
    date,
    entries,
    creationDialog,
    detailPopover,
    contextMenu,
    previewEntry,

    // Date navigation
    setDate,
    goToToday,

    // Entry CRUD
    createEntry,
    updateEntry,
    deleteEntry,
    duplicateEntry,
    moveEntry,
    resizeEntry,

    // Dialog handlers
    openCreationDialog,
    closeCreationDialog,
    setCreationDialogOpen,
    movePreview,

    // Context menu handlers
    openContextMenu,
    closeContextMenu,

    // Detail popover handlers
    openDetailPopover,
    closeDetailPopover,

    // Pre-bound handlers for DayCalendar
    handlers: {
      onDateChange: setDate,
      onCreateSelection: openCreationDialog,
      onEntryClick: handleEntryClick,
      onEntryContextMenu: openContextMenu,
      onEntryMove: moveEntry,
      onEntryResize: resizeEntry,
      onPreviewMove: movePreview,
      onTaskClick: handleTaskClick,
    },
  };
}
