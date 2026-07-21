'use client';

/**
 * `ConfirmDeleteDialog` — the one destructive-confirmation dialog every entity detail page shares.
 *
 * @remarks
 * A thin, entity-agnostic wrapper over the {@link Dialog} primitive from `@docket/ui`, which
 * inherits Radix's focus trap, `Escape`-to-close, scroll-lock, return-focus-to-opener, and the
 * `aria-labelledby`/`aria-describedby` wiring for free. The caller owns the open state and the
 * delete action; this component only renders the MD3 tonal panel, a destructive confirm button,
 * and a Cancel affordance. Copy (title/description/confirm label) is passed in so a project,
 * initiative, program, or any other entity reuses the exact same control with its own wording.
 *
 * While `pending` is `true` both buttons disable and the dialog resists dismissal (overlay,
 * `Escape`, and Cancel are inert), so an in-flight delete cannot be interrupted mid-request.
 *
 * The component never auto-dismisses on confirm — the caller owns `open`. On a failed delete keep
 * the dialog open and pass `error` so the feedback renders inside the panel (a `role="alert"` line
 * above the actions) rather than behind the modal or silently; on success close or navigate away.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * const [error, setError] = useState<string | null>(null);
 * const del = useApiMutation({ ... });
 * <ConfirmDeleteDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="Delete project?"
 *   description="This permanently removes the project and its tasks. This can't be undone."
 *   confirmLabel="Delete project"
 *   pending={del.isPending}
 *   error={error}
 *   onConfirm={() =>
 *     del.mutate(undefined, {
 *       onSuccess: () => setOpen(false),
 *       onError: () => setError("Couldn't delete the project. Try again."),
 *     })
 *   }
 * />
 * ```
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

/** Props for {@link ConfirmDeleteDialog}. */
export interface ConfirmDeleteDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open/close handler (also fired on overlay/escape dismiss); ignored while `pending`. */
  onOpenChange: (open: boolean) => void;
  /** Dialog heading, e.g. `"Delete project?"`. */
  title: ReactNode;
  /** Explains what deleting does and that it is irreversible. */
  description: ReactNode;
  /** Label for the destructive confirm button (default `"Delete"`). */
  confirmLabel?: string;
  /** Whether the delete is in flight; disables both buttons and blocks dismissal. */
  pending?: boolean;
  /**
   * Message for a failed delete, surfaced inside the dialog as a `role="alert"` line above the
   * actions. Pass application-owned copy — never raw exception/provider text. The caller keeps the
   * dialog `open` on failure so the error stays visible; clear it (`null`/omit) on retry or success.
   */
  error?: string | null;
  /** Invoked when the user confirms the deletion. */
  onConfirm: () => void;
}

/** The shared destructive-confirmation dialog for entity "Delete <entity>" actions. */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  pending = false,
  error,
  onConfirm,
}: ConfirmDeleteDialogProps): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return; // don't dismiss mid-request
        onOpenChange(next);
      }}
    >
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-body-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
