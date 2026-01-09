'use client';

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from './button';

// =============================================================================
// Types
// =============================================================================

export interface SnackbarAction {
  label: string;
  onClick: () => void;
}

export interface SnackbarOptions {
  message: string;
  action?: SnackbarAction;
  duration?: number;
}

interface SnackbarState {
  id: string;
  message: string;
  action?: SnackbarAction;
  duration: number;
}

interface SnackbarContextValue {
  show: (options: SnackbarOptions) => string;
  dismiss: (id: string) => void;
}

// =============================================================================
// Context
// =============================================================================

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

// =============================================================================
// Hook
// =============================================================================

export function useSnackbar() {
  const context = useContext(SnackbarContext);
  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider');
  }
  return context;
}

// =============================================================================
// Provider
// =============================================================================

const DEFAULT_DURATION = 4000;

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snackbars, setSnackbars] = useState<SnackbarState[]>([]);
  const idCounter = useRef(0);

  const show = useCallback((options: SnackbarOptions): string => {
    const id = `snackbar-${String(++idCounter.current)}`;
    const snackbar: SnackbarState = {
      id,
      message: options.message,
      action: options.action,
      duration: options.duration ?? DEFAULT_DURATION,
    };

    setSnackbars((_prev) => {
      // Only keep the most recent snackbar (MD3 style - one at a time)
      return [snackbar];
    });

    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setSnackbars((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return (
    <SnackbarContext.Provider value={{ show, dismiss }}>
      {children}
      <SnackbarContainer snackbars={snackbars} onDismiss={dismiss} />
    </SnackbarContext.Provider>
  );
}

// =============================================================================
// Container
// =============================================================================

interface SnackbarContainerProps {
  snackbars: SnackbarState[];
  onDismiss: (id: string) => void;
}

function SnackbarContainer({ snackbars, onDismiss }: SnackbarContainerProps) {
  if (typeof window === 'undefined') return null;

  return createPortal(
    <div className="pointer-events-none fixed right-0 bottom-0 left-0 z-50 flex flex-col items-center p-4">
      {snackbars.map((snackbar) => (
        <SnackbarItem
          key={snackbar.id}
          snackbar={snackbar}
          onDismiss={() => {
            onDismiss(snackbar.id);
          }}
        />
      ))}
    </div>,
    document.body,
  );
}

// =============================================================================
// Snackbar Item
// =============================================================================

interface SnackbarItemProps {
  snackbar: SnackbarState;
  onDismiss: () => void;
}

function SnackbarItem({ snackbar, onDismiss }: SnackbarItemProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Auto-dismiss timer
    const timer = setTimeout(() => {
      setIsLeaving(true);
      setTimeout(onDismiss, 150);
    }, snackbar.duration);

    return () => {
      clearTimeout(timer);
    };
  }, [snackbar.duration, onDismiss]);

  const handleAction = useCallback(() => {
    snackbar.action?.onClick();
    setIsLeaving(true);
    setTimeout(onDismiss, 150);
  }, [snackbar.action, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-3',
        'bg-inverse-surface text-inverse-on-surface shadow-lg',
        'transition-all duration-150 ease-out',
        isVisible && !isLeaving ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <span className="text-body-medium">{snackbar.message}</span>
      {snackbar.action && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAction}
          className="text-inverse-primary hover:bg-inverse-primary/10 -mr-2"
        >
          {snackbar.action.label}
        </Button>
      )}
    </div>
  );
}
