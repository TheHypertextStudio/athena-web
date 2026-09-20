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
 * the whole form is disabled while a create is in flight. Dismissing a *dirty* draft (non-empty
 * identity, description, or supplemental input) asks for confirmation first, so an accidental Esc,
 * backdrop click, or close action never silently discards typed work.
 *
 * The dialog carries no visible "New task" heading at all: the title field is the focus, and
 * `heading` exists to name the dialog for assistive tech (it renders `sr-only`), not to take up
 * space a reader has to scan past. When the composer also supplies `icon`/`context` (e.g. a team
 * breadcrumb), that row still renders — it carries information the title field doesn't. The panel
 * is a single flat surface (`surface-container-high`); structure comes from the borderless tonal
 * property pills, not from extra surfaces or outlines.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  type DialogPresentation,
} from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { Maximize, Minimize } from '@docket/ui/icons';
import {
  type JSX,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { handleContinueChord } from './continue-chord';
import type { ComposerDraftControls } from './use-composer-draft-persistence';
import { useDiscardPrompt } from './use-discard-prompt';

import { useDocumentContents } from '@/components/editor/document-contents';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import type { EditorContribution } from '@/components/editor/editor-contribution';

import {
  ComposerActionRow,
  ComposerBodyRegion,
  ComposerIdentityHeader,
  PropertyStrip,
} from './composer-shell-regions';

function composerPresentation(expanded: boolean): DialogPresentation {
  return {
    kind: 'responsive-fullscreen',
    size: expanded ? 'detail' : 'large',
    height: expanded ? 'tall' : 'medium',
  };
}

/** The shared controls for submitting a composer and keeping it open. */
export interface ComposerContinuation {
  /** Whether ordinary submission should create another object afterward. */
  checked: boolean;
  /** Change whether ordinary submission should continue. */
  onCheckedChange: (checked: boolean) => void;
  /** Create and continue regardless of the current checked state. */
  onSubmit: () => void;
}

/** One supplemental draft section that shares the composer's body with its description. */
export interface ComposerSupplementalSection {
  /** Stable section identity within this composer. */
  readonly id: string;
  /** Visible tab label. */
  readonly label: string;
  /** Accessible tab label when the visible copy needs added context. */
  readonly accessibleLabel: string;
  /** Optional live item count rendered with the label. */
  readonly count?: number | undefined;
  /** Whether this section contains unsaved input that must be protected on close. */
  readonly dirty?: boolean | undefined;
  /** Draft-aware controls rendered inside the section's body panel. */
  readonly body: ReactNode;
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
   * Global composers supply their complete destination context here, such as Workspace and Team.
   */
  contextRow?: ReactNode | undefined;
  /** Accessible label for the compact property controls. */
  propertyAriaLabel?: string | undefined;
  /** Keep a non-picker child form outside the compact metadata-row behavior. */
  propertyLayout?: 'compact' | 'freeform' | undefined;
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
  /** Supplemental draft sections that use the body without reducing the description's height. */
  supplementalSections?: readonly ComposerSupplementalSection[] | undefined;
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
  /** Feature behavior supplied to the shared description editor. */
  bodyContributions?: readonly EditorContribution[] | undefined;
  /** The destination organization whose entities the body editor may mention. */
  mentionOrgId?: string | undefined;
  /** The inline row of compact property pickers. */
  children: ReactNode;
  /** A server/validation error to surface under the pickers, if any. */
  error?: string | null | undefined;
  /**
   * The saved-draft controls from `useComposerDraftPersistence`. When supplied, the action row
   * gains a Drafts chip and the close prompt offers Save draft; when omitted the composer keeps
   * nothing and the prompt asks only whether to discard.
   */
  drafts?: ComposerDraftControls | undefined;
  /** The noun an untitled draft is called by, vocabulary-skinned ("task"). */
  draftNoun?: string | undefined;
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

/** The banner heading for a composer error: the create itself, or the work that follows it. */
function errorTitle(draftCommitted: boolean): string {
  return draftCommitted ? 'A step after creating did not finish' : 'Could not create this';
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
  propertyAriaLabel = 'Composer properties',
  propertyLayout = 'compact',
  continuation,
  leadingFields,
  supplementalSections = [],
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
  bodyContributions = [],
  mentionOrgId,
  children,
  error,
  drafts,
  draftNoun = 'draft',
  statusMessage,
  draftCommitted = false,
  contentDisabled = false,
  creating,
  canSubmit,
  onSubmit,
  submitLabel,
}: ComposerShellProps): JSX.Element {
  const formId = useId();
  // Expansion and section selection belong to one opening, not to the draft across openings.
  const [expanded, setExpanded] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState('description');
  const bodyColumnRef = useRef<HTMLDivElement>(null);
  // A draft owns no URL — the page under the dialog does — so the rail scrolls without a hash.
  const documentContents = useDocumentContents(bodyColumnRef, body);
  // Same threshold as the detail page: a rail beside two headings is navigation for a distance
  // nobody has to travel.
  const hasContents = bodyPlaceholder !== undefined && documentContents.headings.length >= 2;

  // A draft worth protecting has typed text or supplemental input; default property picks are not.
  const isDirty =
    !draftCommitted &&
    (title.trim().length > 0 ||
      (summary ?? '').trim().length > 0 ||
      body.trim().length > 0 ||
      supplementalSections.some((section) => section.dirty === true));
  // The hook decides when the draft is locked. It is locked while its own create is in flight,
  // and that is the correct behavior for a one-draft composer: this request is *about* these
  // values, so a field edited after submitting would show a change the created object does not
  // have. `aria-busy` below says why the form has gone quiet. It is locked again under the close
  // prompt, so nothing behind the prompt can submit the form it has visually replaced.
  const prompt = useDiscardPrompt({
    creating,
    contentDisabled,
    canSubmit,
    isDirty,
    onOpenChange,
    titleInputRef,
  });
  const { confirming: confirmingDiscard, editDisabled, submittable } = prompt;
  const hasLegacyIcon = icon !== undefined && icon !== null && icon !== false;
  const hasLegacyContext = context !== undefined && context !== null && context !== false;
  const legacyContextVisible = hasLegacyIcon || hasLegacyContext;
  const hasSectionSwitcher = bodyPlaceholder !== undefined && supplementalSections.length > 0;
  const sectionValue = (sectionId: string): string => `${formId}-${sectionId}`;

  useEffect(() => {
    if (!open) return;
    setExpanded(false);
    setActiveSectionId('description');
  }, [open]);

  /** Select a body section and enter its first useful draft control. */
  const selectSection = (value: string): void => {
    const nextSection = [
      { id: 'description' },
      ...supplementalSections.map((section) => ({ id: section.id })),
    ].find((section) => sectionValue(section.id) === value);
    if (!nextSection) return;
    setActiveSectionId(nextSection.id);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`tabpanel-${value}`)
        ?.querySelector<HTMLElement>(
          'input:not(:disabled), textarea:not(:disabled), button:not(:disabled), [contenteditable="true"]',
        )
        ?.focus({ preventScroll: true });
    });
  };

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
        contributions={bodyContributions}
        onSubmit={() => {
          if (submittable) onSubmit();
        }}
        className="bg-surface-container-low flex min-h-28 flex-1 flex-col overflow-y-auto overscroll-contain rounded-lg p-3 [&>div]:flex-1"
      />
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        prompt.requestClose();
      }}
    >
      <DialogContent
        presentation={composerPresentation(expanded)}
        aria-describedby={undefined}
        // The whole form goes inert while a create is in flight. Without this, assistive tech has
        // no way to tell that apart from a form that is simply not editable.
        aria-busy={creating}
        onEscapeKeyDown={prompt.onEscapeKeyDown}
        onKeyDownCapture={(event) => {
          handleContinueChord(event, continuation, submittable);
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
            controlSize="sm"
            aria-label={expanded ? 'Collapse editor' : 'Expand editor'}
            aria-pressed={expanded}
            disabled={editDisabled}
            onClick={() => {
              setExpanded((current) => !current);
            }}
            className="coarse:right-[3.75rem] absolute top-4 right-12 z-10 hidden sm:inline-flex"
          >
            {expanded ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
          </Button>
        ) : null}

        {/* A composer owns its destination context. Template actions belong inside the editor. */}
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (submittable) onSubmit();
          }}
          className="contents"
        >
          <ComposerIdentityHeader
            contextRow={contextRow}
            icon={icon}
            context={context}
            legacyContextVisible={legacyContextVisible}
            bodyPlaceholder={bodyPlaceholder}
            leadingFields={leadingFields}
            editDisabled={editDisabled}
            title={title}
            onTitleChange={onTitleChange}
            titleInputRef={prompt.titleRef}
            titlePlaceholder={titlePlaceholder}
            summary={summary}
            onSummaryChange={onSummaryChange}
            summaryPlaceholder={summaryPlaceholder}
            summaryMaxLength={summaryMaxLength}
            hasSectionSwitcher={hasSectionSwitcher}
            activeSectionValue={sectionValue(activeSectionId)}
            onSectionValueChange={selectSection}
            supplementalSections={supplementalSections}
            sectionValue={sectionValue}
          />

          {/* `@container` goes on the body region and the columns on the child, because a
           *  container query never matches the element that declares the container. The rail needs
           *  more width than the collapsed `large` tier has to spare, so `@2xl` is also what keeps
           *  it to the expanded `detail` panel without the shell having to know which tier it is
           *  in. */}
          <ComposerBodyRegion
            editor={bodyEditor}
            mentionOrgId={mentionOrgId}
            columnRef={bodyColumnRef}
            contents={documentContents}
            hasContents={hasContents}
            freeformFields={propertyLayout === 'freeform' ? children : null}
            supplementalSections={supplementalSections}
            activeSectionId={activeSectionId}
            sectionValue={sectionValue}
            editDisabled={editDisabled}
          />

          {/* Action bar: pills, then error, then the single primary action — all pinned below the
           *  scrolling body so a long AI-drafted description can never carry them out of view or
           *  interleave them with its own text. */}
          <DialogFooter
            inset="responsive"
            className="flex-col gap-3 sm:flex-col sm:items-stretch sm:justify-start"
          >
            {!confirmingDiscard && propertyLayout === 'compact' ? (
              <PropertyStrip ariaLabel={propertyAriaLabel}>{children}</PropertyStrip>
            ) : null}
            {!confirmingDiscard && error ? (
              <InlineBanner tone="critical" density="compact" title={errorTitle(draftCommitted)}>
                {error}
              </InlineBanner>
            ) : null}
            <ComposerActionRow
              confirmingDiscard={confirmingDiscard}
              onKeepEditing={prompt.keepEditing}
              onDiscard={prompt.discard}
              drafts={drafts}
              draftNoun={draftNoun}
              continuation={continuation}
              editDisabled={editDisabled}
              formId={formId}
              creating={creating}
              canSubmit={canSubmit}
              submitLabel={submitLabel}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
