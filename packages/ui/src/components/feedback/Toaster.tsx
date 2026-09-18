'use client';

/**
 * `@docket/ui` — where notices appear. Mount once, at the application root.
 *
 * @remarks
 * Wraps sonner's toaster with Docket's placement and no styling of its own: every card is a
 * {@link ToastCard}. Bottom-right keeps the sidebar, the rail, and the Today composer clear; on a
 * phone sonner collapses to a full-width bottom stack. The stack stays interactive while a modal
 * dialog is open, which is what lets "Try again" on a failed create be clicked from the composer.
 */
import { Toaster as SonnerToaster } from 'sonner';

/** Props for {@link Toaster}. */
export interface ToasterProps {
  /** Where notices stack. Default `bottom-right`. */
  readonly position?: 'bottom-right' | 'bottom-center' | undefined;
  /** How many notices show at once before older ones queue. Default 3. */
  readonly visibleToasts?: number | undefined;
}

/** The gutter between the stack and the viewport edge, matching the shell's page gutter. */
const VIEWPORT_OFFSET = 16;

/**
 * The notice stack.
 *
 * @param props - Placement.
 * @returns the toaster, which renders nothing until a notice is shown.
 */
export function Toaster({
  position = 'bottom-right',
  visibleToasts = 3,
}: ToasterProps): React.JSX.Element {
  return (
    <SonnerToaster
      position={position}
      visibleToasts={visibleToasts}
      gap={8}
      expand={false}
      offset={VIEWPORT_OFFSET}
      mobileOffset={VIEWPORT_OFFSET}
      toastOptions={{ unstyled: true, className: 'pointer-events-auto' }}
      // Sonner's region is styled by its own stylesheet; the z token keeps it above dialogs.
      className="pointer-events-auto z-(--z-toast)"
    />
  );
}
