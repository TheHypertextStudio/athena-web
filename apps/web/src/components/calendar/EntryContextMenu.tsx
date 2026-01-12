'use client';

import { useCallback, useEffect, useRef } from 'react';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import { cn } from '@/lib/utils';
import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar';

// =============================================================================
// Types
// =============================================================================

export interface EntryContextMenuProps {
  entry: CalendarEntry | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onEdit?: (entry: CalendarEntry) => void;
  onDuplicate?: (entry: CalendarEntry) => void;
  onReschedule?: (entry: CalendarEntry) => void;
  onDelete?: (entry: CalendarEntry) => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

// =============================================================================
// MenuItem Component
// =============================================================================

function MenuItem({ icon, label, onClick, destructive }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        'hover:bg-surface-container-highest',
        destructive ? 'text-error' : 'text-on-surface',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function EntryContextMenu({
  entry,
  position,
  onClose,
  onEdit,
  onDuplicate,
  onReschedule,
  onDelete,
}: EntryContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!position) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [position, onClose]);

  const handleEdit = useCallback(() => {
    if (entry) {
      onEdit?.(entry);
      onClose();
    }
  }, [entry, onEdit, onClose]);

  const handleDuplicate = useCallback(() => {
    if (entry) {
      onDuplicate?.(entry);
      onClose();
    }
  }, [entry, onDuplicate, onClose]);

  const handleReschedule = useCallback(() => {
    if (entry) {
      onReschedule?.(entry);
      onClose();
    }
  }, [entry, onReschedule, onClose]);

  const handleDelete = useCallback(() => {
    if (entry) {
      onDelete?.(entry);
      onClose();
    }
  }, [entry, onDelete, onClose]);

  if (!position || !entry) return null;

  return (
    <div
      ref={menuRef}
      className="bg-surface-container fixed z-50 min-w-[160px] rounded-lg py-1 shadow-lg"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <MenuItem
        icon={<EditOutlinedIcon sx={{ fontSize: 20 }} />}
        label="Edit"
        onClick={handleEdit}
      />
      <MenuItem
        icon={<ContentCopyOutlinedIcon sx={{ fontSize: 20 }} />}
        label="Duplicate"
        onClick={handleDuplicate}
      />
      <MenuItem
        icon={<ScheduleOutlinedIcon sx={{ fontSize: 20 }} />}
        label="Reschedule"
        onClick={handleReschedule}
      />
      <div className="bg-outline-variant mx-2 my-1 h-px" />
      <MenuItem
        icon={<DeleteOutlineIcon sx={{ fontSize: 20 }} />}
        label="Delete"
        onClick={handleDelete}
        destructive
      />
    </div>
  );
}
