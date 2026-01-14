/**
 * Project selector popover component.
 *
 * Allows changing a task's project assignment with a searchable dropdown.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Plus, X, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Project {
  id: string;
  name: string;
}

export interface ProjectSelectorProps {
  /** Currently selected project ID */
  value: string | null;
  /** Callback when project selection changes */
  onChange: (projectId: string | null) => void;
  /** Available projects */
  projects: Project[];
  /** Whether the selector is open */
  open: boolean;
  /** Callback when selector should close */
  onClose: () => void;
  /** Anchor element for positioning */
  anchorRect?: DOMRect | null;
  /** Callback to create a new project (optional) */
  onCreateProject?: (name: string) => Promise<Project>;
  /** Additional class name */
  className?: string;
}

/**
 * Project selector with search and optional creation.
 */
export const ProjectSelector = memo(function ProjectSelector({
  value,
  onChange,
  projects,
  open,
  onClose,
  anchorRect,
  onCreateProject,
  className,
}: ProjectSelectorProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [mounted, setMounted] = useState(false);

  // SSR safety: only render portal after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset search when opened
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setIsCreating(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
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
  }, [open, onClose]);

  const handleSelect = useCallback(
    (projectId: string | null) => {
      onChange(projectId);
      onClose();
    },
    [onChange, onClose],
  );

  const handleCreateProject = useCallback(async () => {
    if (!searchQuery.trim() || !onCreateProject || isCreating) return;

    setIsCreating(true);
    try {
      const newProject = await onCreateProject(searchQuery.trim());
      handleSelect(newProject.id);
    } catch {
      // Error handling
    } finally {
      setIsCreating(false);
    }
  }, [searchQuery, onCreateProject, isCreating, handleSelect]);

  // Filter projects by search query
  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const showCreateOption =
    onCreateProject &&
    searchQuery.trim() &&
    !filteredProjects.some((p) => p.name.toLowerCase() === searchQuery.toLowerCase());

  if (!open || !mounted) return null;

  // Calculate position
  const popoverWidth = 240;
  const padding = 8;

  let x = anchorRect ? anchorRect.left : 0;
  let y = anchorRect ? anchorRect.bottom + padding : 0;

  if (typeof window !== 'undefined' && anchorRect) {
    if (x + popoverWidth + padding > window.innerWidth) {
      x = window.innerWidth - popoverWidth - padding;
    }
    if (y + 280 > window.innerHeight) {
      y = anchorRect.top - 280 - padding;
    }
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={popoverRef}
        initial={{ opacity: 0, scale: 0.95, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -4 }}
        transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
        style={anchorRect ? { left: x, top: y, position: 'fixed' } : undefined}
        className={cn(
          'z-50 w-[240px]',
          'bg-surface-container border-outline-variant rounded-xl border',
          'shadow-lg',
          !anchorRect && 'relative',
          className,
        )}
      >
        {/* Header */}
        <div className="border-outline-variant/50 border-b px-3 py-2">
          <div className="text-on-surface-variant mb-2 text-xs font-medium">Move to Project</div>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className={cn(
              'bg-surface-container-low border-outline-variant',
              'w-full rounded-lg border px-2.5 py-1.5 text-sm',
              'focus:border-primary focus:ring-primary/30 focus:ring-1 focus:outline-none',
              'transition-colors duration-150',
              'placeholder:text-on-surface-variant/50',
            )}
          />
        </div>

        {/* Options */}
        <div className="max-h-[200px] overflow-y-auto py-1">
          {filteredProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                handleSelect(project.id);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm',
                'transition-colors duration-100',
                'hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none',
                value === project.id && 'bg-primary/5',
              )}
            >
              <Folder className="text-on-surface-variant h-4 w-4" />
              <span className="flex-1 truncate text-left">{project.name}</span>
              {value === project.id && <Check className="text-primary h-4 w-4" />}
            </button>
          ))}

          {/* Create new project option */}
          {showCreateOption && (
            <button
              type="button"
              onClick={() => {
                void handleCreateProject();
              }}
              disabled={isCreating}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm',
                'text-primary',
                'transition-colors duration-100',
                'hover:bg-primary/5 focus:bg-primary/5 focus:outline-none',
                isCreating && 'opacity-50',
              )}
            >
              <Plus className="h-4 w-4" />
              <span className="flex-1 truncate text-left">
                {isCreating ? 'Creating...' : `Create "${searchQuery}"`}
              </span>
            </button>
          )}

          {filteredProjects.length === 0 && !showCreateOption && (
            <div className="text-on-surface-variant px-3 py-4 text-center text-sm">
              No projects found
            </div>
          )}
        </div>

        {/* No project option */}
        <div className="border-outline-variant/50 border-t py-1">
          <button
            type="button"
            onClick={() => {
              handleSelect(null);
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-sm',
              'transition-colors duration-100',
              'hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none',
              value === null && 'bg-primary/5',
            )}
          >
            <X className="text-on-surface-variant h-4 w-4" />
            <span className="flex-1 text-left">No Project</span>
            {value === null && <Check className="text-primary h-4 w-4" />}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
});

export default ProjectSelector;
