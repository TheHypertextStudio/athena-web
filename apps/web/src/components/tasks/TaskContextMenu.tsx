/**
 * Context menu component for tasks.
 *
 * Provides quick actions like status change, priority change,
 * project assignment, copy link, and delete.
 *
 * @packageDocumentation
 */

'use client';

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  Circle,
  Clock,
  Copy,
  Trash2,
  Calendar,
  Flag,
  Folder,
  ChevronRight,
  LayoutGrid,
} from 'lucide-react';
import { type Task, type TimeBlock } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

export interface Project {
  id: string;
  name: string;
}

export interface TaskContextMenuProps {
  /** The task being acted upon */
  task: Task | null;
  /** Position to display the menu */
  position: { x: number; y: number } | null;
  /** Callback to close the menu */
  onClose: () => void;
  /** Callback when status changes */
  onStatusChange?: (taskId: string, status: TaskStatus) => Promise<void>;
  /** Callback when priority changes */
  onPriorityChange?: (taskId: string, priority: TaskPriority) => Promise<void>;
  /** Callback when project changes */
  onProjectChange?: (taskId: string, projectId: string | null) => Promise<void>;
  /** Callback when task is deleted */
  onDelete?: (taskId: string) => Promise<void>;
  /** Callback when task is added to a time block */
  onAddToTimeBlock?: (taskId: string, timeBlockId: string) => Promise<void>;
  /** Available projects */
  projects?: Project[];
  /** Available time blocks (typically today's time blocks) */
  timeBlocks?: TimeBlock[];
}

const priorityOptions: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: 'text-error' },
  { value: 'high', label: 'High', color: 'text-warning' },
  { value: 'medium', label: 'Medium', color: 'text-primary' },
  { value: 'low', label: 'Low', color: 'text-on-surface-variant' },
];

interface MenuItemProps {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hasSubmenu?: boolean;
  checked?: boolean;
  className?: string;
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  hasSubmenu = false,
  checked = false,
  className,
}: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-sm',
        'transition-colors duration-100',
        'focus:outline-none',
        danger
          ? 'text-error hover:bg-error/10 focus:bg-error/10'
          : 'text-on-surface hover:bg-surface-container-high focus:bg-surface-container-high',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span className="flex-1 text-left">{label}</span>
      {checked && <Check className="h-4 w-4 flex-shrink-0" />}
      {hasSubmenu && <ChevronRight className="h-4 w-4 flex-shrink-0" />}
    </button>
  );
}

function MenuSeparator() {
  return <div className="bg-outline-variant/50 my-1 h-px" />;
}

/**
 * Context menu for task actions.
 */
export const TaskContextMenu = memo(function TaskContextMenu({
  task,
  position,
  onClose,
  onStatusChange,
  onPriorityChange,
  onProjectChange,
  onDelete,
  onAddToTimeBlock,
  projects = [],
  timeBlocks = [],
}: TaskContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showPrioritySubmenu, setShowPrioritySubmenu] = useState(false);
  const [showProjectSubmenu, setShowProjectSubmenu] = useState(false);
  const [showTimeBlockSubmenu, setShowTimeBlockSubmenu] = useState(false);
  const [mounted, setMounted] = useState(false);

  // SSR safety: only render portal after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!task || !position) return;

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
  }, [task, position, onClose]);

  const handleStatusToggle = useCallback(async () => {
    if (!task || !onStatusChange) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    await onStatusChange(task.id, newStatus);
    onClose();
  }, [task, onStatusChange, onClose]);

  const handleStartWorking = useCallback(async () => {
    if (!task || !onStatusChange) return;
    await onStatusChange(task.id, 'in_progress');
    onClose();
  }, [task, onStatusChange, onClose]);

  const handlePriorityChange = useCallback(
    async (priority: TaskPriority) => {
      if (!task || !onPriorityChange) return;
      await onPriorityChange(task.id, priority);
      setShowPrioritySubmenu(false);
      onClose();
    },
    [task, onPriorityChange, onClose],
  );

  const handleProjectChange = useCallback(
    async (projectId: string | null) => {
      if (!task || !onProjectChange) return;
      await onProjectChange(task.id, projectId);
      setShowProjectSubmenu(false);
      onClose();
    },
    [task, onProjectChange, onClose],
  );

  const handleCopyLink = useCallback(() => {
    if (!task) return;
    const url = `${window.location.origin}/tasks/${task.id}`;
    void navigator.clipboard.writeText(url);
    onClose();
  }, [task, onClose]);

  const handleDelete = useCallback(async () => {
    if (!task || !onDelete) return;
    await onDelete(task.id);
    onClose();
  }, [task, onDelete, onClose]);

  const handleAddToTimeBlock = useCallback(
    async (timeBlockId: string) => {
      if (!task || !onAddToTimeBlock) return;
      await onAddToTimeBlock(task.id, timeBlockId);
      setShowTimeBlockSubmenu(false);
      onClose();
    },
    [task, onAddToTimeBlock, onClose],
  );

  if (!task || !position || !mounted) return null;

  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';

  // Calculate position to keep menu in viewport
  const menuWidth = 220;
  const menuHeight = 280;
  const padding = 8;

  let x = position.x;
  let y = position.y;

  if (typeof window !== 'undefined') {
    if (x + menuWidth + padding > window.innerWidth) {
      x = window.innerWidth - menuWidth - padding;
    }
    if (y + menuHeight + padding > window.innerHeight) {
      y = window.innerHeight - menuHeight - padding;
    }
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.1 }}
        style={{ left: x, top: y }}
        className={cn(
          'fixed z-50',
          'bg-surface-container border-outline-variant min-w-[200px] rounded-xl border py-1',
          'shadow-lg',
        )}
      >
        {/* Status actions */}
        <MenuItem
          icon={isCompleted ? <Circle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          label={isCompleted ? 'Mark as Incomplete' : 'Mark as Complete'}
          onClick={() => {
            void handleStatusToggle();
          }}
        />
        {!isCompleted && !isInProgress && (
          <MenuItem
            icon={<Clock className="h-4 w-4" />}
            label="Start Working"
            onClick={() => {
              void handleStartWorking();
            }}
          />
        )}

        <MenuSeparator />

        {/* Quick actions */}
        <MenuItem icon={<Calendar className="h-4 w-4" />} label="Set Due Date..." disabled />

        {/* Priority submenu */}
        <div
          className="relative"
          onMouseEnter={() => {
            setShowPrioritySubmenu(true);
          }}
          onMouseLeave={() => {
            setShowPrioritySubmenu(false);
          }}
        >
          <MenuItem icon={<Flag className="h-4 w-4" />} label="Set Priority" hasSubmenu />
          <AnimatePresence>
            {showPrioritySubmenu && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.1 }}
                className={cn(
                  'absolute top-0 left-full ml-1',
                  'bg-surface-container border-outline-variant min-w-[140px] rounded-xl border py-1',
                  'shadow-lg',
                )}
              >
                {priorityOptions.map((option) => (
                  <MenuItem
                    key={option.value}
                    icon={<Flag className={cn('h-4 w-4', option.color)} />}
                    label={option.label}
                    checked={task.priority === option.value}
                    onClick={() => void handlePriorityChange(option.value)}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Project submenu */}
        {projects.length > 0 && (
          <div
            className="relative"
            onMouseEnter={() => {
              setShowProjectSubmenu(true);
            }}
            onMouseLeave={() => {
              setShowProjectSubmenu(false);
            }}
          >
            <MenuItem icon={<Folder className="h-4 w-4" />} label="Move to Project" hasSubmenu />
            <AnimatePresence>
              {showProjectSubmenu && (
                <motion.div
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={{ duration: 0.1 }}
                  className={cn(
                    'absolute top-0 left-full ml-1',
                    'bg-surface-container border-outline-variant min-w-[160px] rounded-xl border py-1',
                    'shadow-lg',
                  )}
                >
                  {projects.map((project) => (
                    <MenuItem
                      key={project.id}
                      label={project.name}
                      checked={task.projectId === project.id}
                      onClick={() => void handleProjectChange(project.id)}
                    />
                  ))}
                  <MenuSeparator />
                  <MenuItem
                    label="No Project"
                    checked={!task.projectId}
                    onClick={() => void handleProjectChange(null)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Time block submenu */}
        {timeBlocks.length > 0 && (
          <div
            className="relative"
            onMouseEnter={() => {
              setShowTimeBlockSubmenu(true);
            }}
            onMouseLeave={() => {
              setShowTimeBlockSubmenu(false);
            }}
          >
            <MenuItem
              icon={<LayoutGrid className="h-4 w-4" />}
              label="Add to Time Block"
              hasSubmenu
            />
            <AnimatePresence>
              {showTimeBlockSubmenu && (
                <motion.div
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={{ duration: 0.1 }}
                  className={cn(
                    'absolute top-0 left-full ml-1',
                    'bg-surface-container border-outline-variant min-w-[180px] rounded-xl border py-1',
                    'shadow-lg',
                  )}
                >
                  {timeBlocks.map((block) => (
                    <MenuItem
                      key={block.id}
                      icon={
                        block.color ? (
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: block.color }}
                          />
                        ) : (
                          <LayoutGrid className="h-4 w-4" />
                        )
                      }
                      label={block.label}
                      onClick={() => void handleAddToTimeBlock(block.id)}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <MenuSeparator />

        {/* Other actions */}
        <MenuItem icon={<Copy className="h-4 w-4" />} label="Copy Link" onClick={handleCopyLink} />

        <MenuSeparator />

        {/* Danger actions */}
        <MenuItem
          icon={<Trash2 className="h-4 w-4" />}
          label="Delete"
          danger
          onClick={() => void handleDelete()}
        />
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
});

export default TaskContextMenu;
