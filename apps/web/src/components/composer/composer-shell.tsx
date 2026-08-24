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
 * The dialog carries no visible "New task" heading at all: the title field is the focus, and
 * `heading` exists to name the dialog for assistive tech (it renders `sr-only`), not to take up
 * space a reader has to scan past. When the composer also supplies `icon`/`context` (e.g. a team
 * breadcrumb), that row still renders — it carries information the title field doesn't. The panel
 * is a single flat surface (`surface-container-high`); structure comes from the borderless tonal
 * property pills, not from extra surfaces or outlines.
 */
import { Button, Dialog, DialogContent, DialogTitle } from '@docket/ui/primitives';
import { Maximize } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type ReactNode, type RefObject, useId, useState } from 'react';

import { FreeformTextEditor } from '@/components/editor/freeform-text';
import MentionHydrationProvider from '@/components/mentions/mention-hydration';

/** The shared controls for submitting a composer and keeping it open. */
export interface ComposerContinuation {
  /** Whether ordinary submission should create another object afterward. */
  checked: boolean;
  /** Change whether ordinary submission should continue. */
  onCheckedChange: (checked: boolean) => void;
  /** Create and continue regardless of the current checked state. */
  onSubmit: () => void;
}

/** Props for {@link ComposerShell}. */
export interface ComposerShellProps {
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, discard, or success). */
  onOpenChange: (open: boolean) => void;
  /**
   * The dialog's accessible name (e.g. "New task"), read by assistive tech but never shown — the
   * title field is the only visible heading.
   */
  heading: ReactNode;
  /** Optional leading badge glyph for the breadcrumb (e.g. the entity-type icon). */
  icon?: ReactNode | undefined;
  /** Optional context shown next to `icon` (e.g. the team name). Purely visual — `heading` alone
   *  names the dialog for assistive tech. */
  context?: ReactNode | undefined;
  /**
   * The ordered destination context rendered above the title.
   *
   * @remarks
   * New global composers supply their complete context in this row (for example Workspace,
   * conditional Team, then Template). The older `icon`/`context`/`templateSlot` API remains as a
   * compatibility seam for the page-owned composers that have not migrated yet.
   */
  contextRow?: ReactNode | undefined;
  /**
   * The template control, pinned to the right of the top row.
   *
   * @remarks
   * Deliberately not one of the {@link ComposerShellProps.children} property pills. Every pill in
   * that strip sets one field; a template rewrites the whole draft. Putting a control with that
   * reach among controls without it — and *below* the description it rewrites — is what made the
   * old initiative picker read as a property and behave as a bulldozer.
   */
  templateSlot?: ReactNode | undefined;
  /**
   * Whether the legacy template slot currently renders a control.
   *
   * @remarks
   * Page-owned composers can pass this data-derived flag when their template component returns
   * `null` for an empty response. It lets the shell hide an otherwise blank legacy row and use
   * the no-context title spacing without inferring visibility from a ReactNode.
   */
  templateSlotVisible?: boolean | undefined;
  /** Shared create-and-continue state and submission behavior. */
  continuation?: ComposerContinuation | undefined;
  /**
   * Extra fields rendered above the title, for composers whose subject is not the entity itself.
   *
   * @remarks
   * The template editor uses this for the template's own name and sharing scope: below them the
   * shell renders the ordinary entity fields, so authoring a template looks exactly like creating
   * the thing it makes.
   */
  leadingFields?: ReactNode | undefined;
  /** The current title text. */
  title: string;
  /** Report a changed title. */
  onTitleChange: (title: string) => void;
  /** Optional ref used by a continuation action to return focus to the task title. */
  titleInputRef?: RefObject<HTMLInputElement | null> | undefined;
  /** Accessible label + placeholder for the title field. */
  titlePlaceholder: string;
  /**
   * The current one-line summary text, rendered as an inline document subtitle directly beneath the
   * title. Only shown when {@link ComposerShellProps.onSummaryChange} is supplied.
   */
  summary?: string | undefined;
  /**
   * Report a changed summary. Providing this handler opts the composer into the inline subtitle line
   * between the title and the body; omit it and no summary field renders (backward compatible).
   */
  onSummaryChange?: ((summary: string) => void) | undefined;
  /** Placeholder ghost text for the summary subtitle line. */
  summaryPlaceholder?: string | undefined;
  /** Max character length for the summary field, matching the entity's DTO limit (e.g. 280). */
  summaryMaxLength?: number | undefined;
  /** The current description text. */
  body: string;
  /**
   * A stable generation for an intentional body reset.
   *
   * @remarks
   * Rich-text editors own a document separate from React's input tree. A composer that keeps its
   * dialog open after creating an object may advance this key to start a fresh document without
   * remounting the rest of its draft or disrupting ordinary controlled updates.
   */
  bodyResetKey?: string | number | undefined;
  /** Report a changed description. */
  onBodyChange: (body: string) => void;
  /** Placeholder for the description field (omit to hide the description body entirely). */
  bodyPlaceholder?: string | undefined;
  /** The destination organization whose entities the body editor may mention. */
  mentionOrgId?: string | undefined;
  /** The inline row of compact property pickers. */
  children: ReactNode;
  /** A server/validation error to surface under the pickers, if any. */
  error?: string | null | undefined;
  /** Application-owned success copy announced without adding visible chrome to the composer. */
  statusMessage?: string | null | undefined;
  /** Whether the object was committed and the remaining error belongs to post-create work. */
  draftCommitted?: boolean | undefined;
  /** Disable draft content without disabling a post-create recovery action. */
  contentDisabled?: boolean | undefined;
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
  contextRow,
  templateSlot,
  templateSlotVisible,
  continuation,
  leadingFields,
  title,
  onTitleChange,
  titleInputRef,
  titlePlaceholder,
  summary,
  onSummaryChange,
  summaryPlaceholder,
  summaryMaxLength,
  body,
  bodyResetKey,
  onBodyChange,
  bodyPlaceholder,
  mentionOrgId,
  children,
  error,
  statusMessage,
  draftCommitted = false,
  contentDisabled = false,
  creating,
  canSubmit,
  onSubmit,
  submitLabel,
}: ComposerShellProps): JSX.Element {
  const formId = useId();
  // Whether the user is being asked to confirm discarding a non-empty draft.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Expansion belongs to one opening. Radix resets it through `onOpenAutoFocus` on every reopen.
  const [expanded, setExpanded] = useState(false);

  // A draft worth protecting is one with typed text; bare default property picks are not.
  const isDirty =
    !draftCommitted &&
    (title.trim().length > 0 || (summary ?? '').trim().length > 0 || body.trim().length > 0);
  const legacyTemplateSlotVisible = templateSlotVisible ?? Boolean(templateSlot);
  // The draft is locked while its own create is in flight, and that is the correct behavior for a
  // one-draft composer: this request is *about* these values, so a field edited after submitting
  // would show a change the created object does not have. What was missing was not the ability to
  // keep typing — it was any indication of why the form had gone quiet, which `aria-busy` below
  // now supplies. Letting the next draft start before this one settles needs the pending-insert
  // lifecycle, not a relaxed `disabled`.
  const editDisabled = creating || contentDisabled;
  const hasLegacyIcon = icon !== undefined && icon !== null && icon !== false;
  const hasLegacyContext = context !== undefined && context !== null && context !== false;
  const legacyContextVisible = hasLegacyIcon || hasLegacyContext || legacyTemplateSlotVisible;

  const bodyEditor =
    bodyPlaceholder === undefined ? null : (
      <FreeformTextEditor
        key={bodyResetKey}
        value={body}
        disabled={editDisabled}
        onChange={onBodyChange}
        placeholder={bodyPlaceholder}
        ariaLabel={bodyPlaceholder}
        mentionOrgId={mentionOrgId}
        onSubmit={() => {
          if (canSubmit && !creating) onSubmit();
        }}
        className="bg-surface-container-low mt-3 flex min-h-28 flex-1 flex-col overflow-y-auto overscroll-contain rounded-lg p-3 [&>div]:flex-1"
      />
    );

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
      <DialogContent
        className={cn(
          'h-[min(34rem,75dvh)] max-w-2xl gap-0 overflow-hidden p-0 transition-[height] duration-(--dur-slow) ease-(--ease-in-out) motion-reduce:transition-none',
          expanded && 'h-[min(48rem,85dvh)]',
        )}
        aria-describedby={undefined}
        // The whole form goes inert while a create is in flight. Without this, assistive tech has
        // no way to tell that apart from a form that is simply not editable.
        aria-busy={creating}
        onOpenAutoFocus={() => {
          setExpanded(false);
        }}
        onKeyDownCapture={(event) => {
          if (
            !continuation ||
            event.key !== 'Enter' ||
            !event.shiftKey ||
            (!event.metaKey && !event.ctrlKey) ||
            event.repeat ||
            creating ||
            !canSubmit
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          continuation.onSubmit();
        }}
      >
        {/* The dialog's accessible name — never shown; the title field is the only visible heading. */}
        <DialogTitle className="sr-only">{heading}</DialogTitle>
        <p role="status" aria-live="polite" className="sr-only">
          {statusMessage ?? ''}
        </p>

        {bodyPlaceholder !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            iconOnly
            controlSize="lg"
            aria-label={expanded ? 'Collapse editor' : 'Expand editor'}
            aria-pressed={expanded}
            disabled={editDisabled}
            onClick={() => {
              setExpanded((current) => !current);
            }}
            className="absolute top-4 right-14 z-10"
          >
            <Maximize aria-hidden="true" className={expanded ? 'rotate-180' : undefined} />
          </Button>
        ) : null}

        {/* A migrated composer owns the order of its whole context row. Older page-owned composers
            retain their breadcrumb + right-pinned template layout until their own migration lands. */}
        {contextRow !== undefined ? (
          <div className="text-label-large flex flex-wrap items-center justify-start gap-2 px-6 pt-5 pr-16">
            {contextRow}
          </div>
        ) : icon || context || templateSlot ? (
          <div
            className={cn(
              'flex items-center gap-2 px-6 pt-5 pr-16 text-sm has-[>div:only-child:empty]:hidden',
              !legacyContextVisible && 'hidden',
            )}
          >
            {icon ? (
              <span className="border-outline-variant text-on-surface-variant flex size-5 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">
                {icon}
              </span>
            ) : null}
            {context ? (
              <span className="text-on-surface-variant min-w-0 truncate">{context}</span>
            ) : null}
            {templateSlot ? (
              <div
                className={cn(
                  'ml-auto shrink-0 empty:hidden',
                  !legacyTemplateSlotVisible && 'hidden',
                )}
              >
                {templateSlot}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Content: the title + description own the bulk of the dialog. */}
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !creating) onSubmit();
          }}
          className={cn(
            'flex min-h-0 flex-1 flex-col px-6',
            contextRow !== undefined || legacyContextVisible ? 'pt-3' : 'pt-5',
          )}
        >
          {leadingFields ? (
            <fieldset disabled={editDisabled} className="flex flex-col gap-3 pb-4">
              {leadingFields}
            </fieldset>
          ) : null}

          {/* Header block: the title, and — when opted in — an inline subtitle, read as one document. */}
          <div className="flex flex-col gap-1 pb-3">
            <input
              aria-label={titlePlaceholder}
              placeholder={titlePlaceholder}
              value={title}
              ref={titleInputRef}
              disabled={editDisabled}
              autoFocus
              onChange={(event) => {
                onTitleChange(event.target.value);
              }}
              className="placeholder:text-on-surface-variant text-on-surface w-full bg-transparent text-lg font-medium tracking-tight outline-none disabled:opacity-50"
            />
            {onSummaryChange ? (
              <input
                aria-label={summaryPlaceholder ?? 'Summary'}
                placeholder={summaryPlaceholder}
                maxLength={summaryMaxLength}
                value={summary ?? ''}
                disabled={editDisabled}
                onChange={(event) => {
                  onSummaryChange(event.target.value);
                }}
                className="placeholder:text-on-surface-variant text-on-surface-variant w-full bg-transparent text-base outline-none disabled:opacity-50"
              />
            ) : null}
          </div>

          {bodyEditor !== null ? (
            <>
              {/*
               * The background/padding lives on the editor's own surface, not a wrapping div —
               * that surface is what already turns a click anywhere inside it (including the
               * padding) into a focus. A separate padded wrapper would look identical but leave
               * its own inset dead: clicking there would land on this div instead of the editor,
               * and nothing would happen. `p-3`, not `px-3 py-2`, so the inset reads the same on
               * every side.
               */}
              {mentionOrgId === undefined ? (
                bodyEditor
              ) : (
                <MentionHydrationProvider orgId={mentionOrgId}>
                  {bodyEditor}
                </MentionHydrationProvider>
              )}
            </>
          ) : null}
        </form>

        {/* Properties: one compact row of Linear-style pills. */}
        <div className="flex flex-col gap-2 px-6 pt-2 pb-4">
          <PropertyStrip>{children}</PropertyStrip>
          {error ? (
            <p role="alert" className="text-error text-body-medium">
              {error}
            </p>
          ) : null}
        </div>

        {/* Action row: flat with the panel — a single primary action, or the discard confirmation. */}
        <div className="flex items-center gap-2 px-6 py-3">
          {confirmingDiscard ? (
            <>
              <span className="text-on-surface-variant text-body-medium mr-auto">
                Discard this draft?
              </span>
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
            <>
              {continuation ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={continuation.checked}
                  disabled={editDisabled}
                  onClick={() => {
                    continuation.onCheckedChange(!continuation.checked);
                  }}
                  className="text-on-surface-variant hover:bg-surface-container-high text-label-large mr-auto inline-flex h-8 items-center gap-2 rounded-md px-2 disabled:opacity-50"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'bg-outline-variant inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors',
                      continuation.checked && 'bg-primary justify-end',
                    )}
                  >
                    <span className="bg-surface h-3 w-3 rounded-full" />
                  </span>
                  Create more
                </button>
              ) : null}
              <Button
                type="submit"
                form={formId}
                // Blocked only against submitting the same draft twice; `aria-busy` is what says
                // the first one is under way, so the state is announced rather than merely drawn.
                disabled={creating || !canSubmit}
                aria-busy={creating}
                className={continuation ? undefined : 'ml-auto'}
              >
                {creating ? 'Creating…' : submitLabel}
              </Button>
            </>
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
