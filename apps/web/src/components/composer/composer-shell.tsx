'use client';

/**
 * The shared layout shell for the Linear-grade create composers.
 *
 * @remarks
 * Every create modal — task, project, program, initiative, cycle, team — is the *same* shape: a
 * large autofocused title field, an optional description body, and an inline strip of compact
 * property pickers, all inside a focused {@link Dialog}. This shell owns that chrome (the dialog,
 * the title input, the description textarea, the property-strip wrapper, the error line, and the
 * Cancel / Create footer) so each composer only declares its fields and wires its create call.
 *
 * The shell is intentionally presentational and fully controlled: the host composer owns the
 * title/description text and the `open` state, and supplies the property pickers as `children`.
 * Submit is driven by Enter on the title field (a fast path) as well as the footer button, and
 * the whole form is disabled while a create is in flight.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type ReactNode, useId } from 'react';

/** Props for {@link ComposerShell}. */
export interface ComposerShellProps {
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** The dialog heading (e.g. "New Project"). */
  heading: ReactNode;
  /** A short supporting line under the heading. */
  description?: ReactNode;
  /** The current title text. */
  title: string;
  /** Report a changed title. */
  onTitleChange: (title: string) => void;
  /** Accessible label + placeholder for the title field. */
  titlePlaceholder: string;
  /** The current description text. */
  body: string;
  /** Report a changed description. */
  onBodyChange: (body: string) => void;
  /** Placeholder for the description field (omit to hide the description body entirely). */
  bodyPlaceholder?: string;
  /** The inline strip of compact property pickers. */
  children: ReactNode;
  /** A server/validation error to surface under the strip, if any. */
  error?: string | null;
  /** Whether a create is in flight (disables the form + shows the busy label). */
  creating: boolean;
  /** Whether the form may be submitted (e.g. the title is non-empty + a team resolved). */
  canSubmit: boolean;
  /** Submit the create. */
  onSubmit: () => void;
  /** The Create button label (e.g. "Create Project"). */
  submitLabel: string;
}

/**
 * The shared create-composer dialog shell.
 *
 * @param props - The {@link ComposerShellProps}.
 * @returns the rendered composer dialog.
 */
export function ComposerShell({
  open,
  onOpenChange,
  heading,
  description,
  title,
  onTitleChange,
  titlePlaceholder,
  body,
  onBodyChange,
  bodyPlaceholder,
  children,
  error,
  creating,
  canSubmit,
  onSubmit,
  submitLabel,
}: ComposerShellProps): JSX.Element {
  const formId = useId();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (creating) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !creating) onSubmit();
          }}
          className="flex flex-col gap-3"
        >
          <input
            aria-label={titlePlaceholder}
            placeholder={titlePlaceholder}
            value={title}
            disabled={creating}
            autoFocus
            onChange={(event) => {
              onTitleChange(event.target.value);
            }}
            className="placeholder:text-on-surface-variant text-on-surface w-full bg-transparent text-lg font-medium tracking-tight outline-none disabled:opacity-50"
          />
          {bodyPlaceholder !== undefined ? (
            <textarea
              aria-label={bodyPlaceholder}
              placeholder={bodyPlaceholder}
              value={body}
              disabled={creating}
              rows={3}
              onChange={(event) => {
                onBodyChange(event.target.value);
              }}
              onKeyDown={(event) => {
                // Cmd/Ctrl+Enter submits from the body, mirroring Linear's composer.
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  if (canSubmit && !creating) onSubmit();
                }
              }}
              className="placeholder:text-on-surface-variant text-on-surface text-body min-h-[4.5rem] w-full resize-y bg-transparent leading-relaxed outline-none disabled:opacity-50"
            />
          ) : null}
          <PropertyStrip>{children}</PropertyStrip>
          {error ? (
            <p role="alert" className="text-destructive text-body">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={creating}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" form={formId} disabled={creating || !canSubmit} className="gap-1.5">
            <Plus aria-hidden="true" className="size-4" />
            {creating ? 'Creating…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Props for {@link PropertyStrip}. */
interface PropertyStripProps {
  /** Extra classes for the strip wrapper. */
  className?: string;
  /** The compact property pickers laid out as a wrapping row. */
  children: ReactNode;
}

/**
 * The inline, wrapping row of compact property pickers above the composer footer.
 *
 * @remarks
 * A hairline-topped band that keeps the pickers visually grouped and clearly separate from the
 * title/body. Pickers wrap on narrow widths so the strip never overflows the dialog.
 */
function PropertyStrip({ className, children }: PropertyStripProps): JSX.Element {
  return (
    <div
      className={cn(
        'border-outline-variant flex flex-wrap items-center gap-1.5 border-t pt-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
