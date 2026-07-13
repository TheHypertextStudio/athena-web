'use client';

/**
 * The shared layout shell for the Linear-grade create composers.
 *
 * @remarks
 * Every create modal — task, project, program, initiative, cycle, team — is the *same* shape: a
 * small contextual breadcrumb, a large title field, an optional freeform description, an inline
 * row of compact property pills, and a recessed action bar with a single primary action — all inside
 * a focused {@link Dialog}. This shell owns that chrome so each composer only declares its fields
 * and wires its create call.
 *
 * It is intentionally presentational and fully controlled: the host composer owns the
 * title/description Markdown and the `open` state, and supplies the property pickers as `children`.
 * Submit is driven by Enter on the title field (a fast path) as well as the action-bar button, and
 * the whole form is disabled while a create is in flight. Dismissing a *dirty* draft (a non-empty
 * title or description) asks for confirmation first, so an accidental Esc / backdrop / close never
 * silently discards typed work.
 *
 * The dialog deliberately carries no big "New task" heading or descriptive sentence: the title
 * field is the focus, and a muted breadcrumb is the only label. The panel is a single flat surface
 * (`surface-container-high`); structure comes from the borderless tonal property pills, not from
 * extra surfaces or outlines.
 */
import { Button, Dialog, DialogContent, DialogTitle } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type ReactNode, useId, useState } from 'react';

import { FreeformTextEditor } from '@/components/editor/freeform-text';
/** Props for {@link ComposerShell}. */
export interface ComposerShellProps {
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, discard, or success). */
  onOpenChange: (open: boolean) => void;
  /**
   * The dialog heading (e.g. "New task"). Rendered as a small muted breadcrumb label — never a big
   * self-referential heading — and doubles as the dialog's accessible title.
   */
  heading: ReactNode;
  /** Optional leading badge glyph for the breadcrumb (e.g. the entity-type icon). */
  icon?: ReactNode;
  /** Optional context shown before the heading (e.g. the team name): `{context} › {heading}`. */
  context?: ReactNode;
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
  /** The inline row of compact property pickers. */
  children: ReactNode;
  /** A server/validation error to surface under the pickers, if any. */
  error?: string | null;
  /** Whether a create is in flight (disables the form + shows the busy label). */
  creating: boolean;
  /** Whether the form may be submitted (e.g. the title is non-empty + a team resolved). */
  canSubmit: boolean;
  /** Submit the create. */
  onSubmit: () => void;
  /** The Create button label (e.g. "Create project"). */
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
  icon,
  context,
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
  // Whether the user is being asked to confirm discarding a non-empty draft.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // A draft worth protecting is one with typed text; bare default property picks are not.
  const isDirty = title.trim().length > 0 || body.trim().length > 0;

  /** Gate every dismiss path (Esc, backdrop, X) so a dirty draft is never silently discarded. */
  const requestClose = (): void => {
    if (creating) return;
    if (isDirty) {
      setConfirmingDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  /** Discard the draft and close. */
  const discard = (): void => {
    setConfirmingDiscard(false);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        requestClose();
      }}
    >
      <DialogContent className="max-w-2xl gap-0 p-0" aria-describedby={undefined}>
        {/* Breadcrumb: a muted contextual label, not a heading. Reserve right room for the close X. */}
        <div className="flex items-center gap-2 px-6 pt-5 pr-16 text-sm">
          {icon ? (
            <span className="border-outline-variant text-on-surface-variant flex size-5 shrink-0 items-center justify-center rounded-md border [&_svg]:size-3">
              {icon}
            </span>
          ) : null}
          {context ? (
            <>
              <span className="text-on-surface-variant min-w-0 truncate">{context}</span>
              <span className="text-on-surface-variant shrink-0" aria-hidden="true">
                ›
              </span>
            </>
          ) : null}
          <DialogTitle className="text-on-surface truncate text-sm font-medium">
            {heading}
          </DialogTitle>
        </div>

        {/* Content: the title + description own the bulk of the dialog. */}
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !creating) onSubmit();
          }}
          className="flex flex-col gap-2 px-6 pt-3"
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
            <FreeformTextEditor
              value={body}
              disabled={creating}
              onChange={onBodyChange}
              placeholder={bodyPlaceholder}
              ariaLabel={bodyPlaceholder}
              onSubmit={() => {
                if (canSubmit && !creating) onSubmit();
              }}
              className="max-h-[40vh] min-h-28 overflow-y-auto py-1"
            />
          ) : null}
        </form>

        {/* Properties: one compact row of Linear-style pills. */}
        <div className="flex flex-col gap-2 px-6 pt-2 pb-4">
          <PropertyStrip>{children}</PropertyStrip>
          {error ? (
            <p role="alert" className="text-destructive text-body">
              {error}
            </p>
          ) : null}
        </div>

        {/* Action row: flat with the panel — a single primary action, or the discard confirmation. */}
        <div className="flex items-center gap-2 px-6 py-3">
          {confirmingDiscard ? (
            <>
              <span className="text-on-surface-variant text-body mr-auto">Discard this draft?</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirmingDiscard(false);
                }}
              >
                Keep editing
              </Button>
              <Button type="button" variant="destructive" onClick={discard}>
                Discard
              </Button>
            </>
          ) : (
            <Button
              type="submit"
              form={formId}
              disabled={creating || !canSubmit}
              className="ml-auto"
            >
              {creating ? 'Creating…' : submitLabel}
            </Button>
          )}
        </div>
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
 * The inline, wrapping row of compact property pills.
 *
 * @remarks
 * Borderless tonal pills: each picker trigger gets a `surface-container-highest` fill (one
 * elevation step off the dialog panel, so it reads as a distinct chip in both themes without an
 * outline) and a fully-rounded shape; hover lifts to the indigo `secondary-container`. Pickers
 * wrap on narrow widths so the row never overflows the dialog.
 */
function PropertyStrip({ className, children }: PropertyStripProps): JSX.Element {
  return (
    <div
      className={cn(
        '[&_button]:bg-surface-container-highest [&_button:hover]:bg-secondary-container [&_button:hover]:text-on-secondary-container flex flex-wrap items-center gap-1.5 [&_button]:rounded-full',
        className,
      )}
    >
      {children}
    </div>
  );
}
