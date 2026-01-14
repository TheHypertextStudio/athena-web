/**
 * Shared element transition modal component.
 *
 * Uses Framer Motion's layoutId for smooth shared element transitions
 * between a source element (e.g., TaskRow) and the modal content.
 *
 * NOTE: This modal renders inline (not in a portal) to preserve
 * LayoutGroup context for shared element animations.
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useCallback, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface TransitionModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** The layoutId for shared element transitions with Framer Motion */
  layoutId?: string;
  /** Modal content */
  children: ReactNode;
  /** Additional class name for the content container */
  className?: string;
}

/**
 * Modal component with Framer Motion shared element transitions.
 *
 * Use the same `layoutId` on the source element (e.g., TaskRow) and this modal
 * to create a smooth morphing animation between them.
 */
export function TransitionModal({
  open,
  onClose,
  layoutId,
  children,
  className,
}: TransitionModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  // Focus trap - focus content on open
  useEffect(() => {
    if (open && contentRef.current) {
      contentRef.current.focus();
    }
  }, [open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={handleBackdropClick}
        >
          {/* Scrim/backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-scrim/40 absolute inset-0 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* Content */}
          <motion.div
            ref={contentRef}
            layoutId={layoutId}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            initial={layoutId ? undefined : { opacity: 0, scale: 0.95 }}
            animate={layoutId ? undefined : { opacity: 1, scale: 1 }}
            exit={layoutId ? undefined : { opacity: 0, scale: 0.95 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 30,
            }}
            className={cn(
              'relative z-10',
              'bg-surface-container-low rounded-3xl shadow-2xl',
              'max-h-[85vh] w-full max-w-2xl overflow-hidden',
              'focus:outline-none',
              className,
            )}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default TransitionModal;
