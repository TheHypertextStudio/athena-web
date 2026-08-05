'use client';

/**
 * A quiet rich-text surface that persists as Markdown without exposing Markdown as a UI mode.
 *
 * @remarks
 * There is deliberately no toolbar, source toggle, or document chrome. Familiar keyboard input
 * and Markdown shortcuts work in place; the host only receives serialized Markdown on save.
 */
import Link from '@tiptap/extension-link';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ReactNodeViewRenderer } from '@tiptap/react';

import { cn } from '@docket/ui/lib/utils';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { useActiveOrgIdOptional } from '@/components/active-org';
import MentionHydrationProvider from '@/components/mentions/mention-hydration';
import MentionMenu from '@/components/mentions/mention-menu';
import MentionNodeView from '@/components/mentions/mention-node-view';
import {
  createMentionExtension,
  MENTION_NODE,
  attributesFromRef,
} from '@/components/mentions/mention-extension';
import {
  createLinkUpgradeExtension,
  type PendingLinkUpgrade,
} from '@/components/mentions/link-upgrade';
import { useMentionController } from '@/components/mentions/use-mention-controller';

import { useSlashCommands } from './use-slash-commands';

/** Props for {@link FreeformTextEditor}. */
export interface FreeformTextEditorProps {
  /** Markdown-backed content, never exposed as source syntax in the interface. */
  value: string;
  /** Receives Markdown whenever the visual document changes. */
  onChange: (value: string) => void;
  /** The quiet prompt shown before the user starts writing. */
  placeholder: string;
  /** Accessible label for the editable writing surface. */
  ariaLabel: string;
  /** Disable edits while the host mutation is in flight. */
  disabled?: boolean;
  /** Keep the rendered document readable while preventing edits. */
  readOnly?: boolean;
  /** Called by Cmd/Ctrl+Enter when the host supports an explicit save action. */
  onSubmit?: () => void;
  /** Called by Escape when the host supports cancelling an edit. */
  onCancel?: () => void;
  /** Additional styling for the editor container. */
  className?: string;
  /**
   * The organization whose entities and connected apps `@` can reference.
   *
   * @remarks
   * Absent means mentions are off for this surface, which is the right default for a field with
   * no workspace context rather than a reason to guess one.
   */
  mentionOrgId?: string;
}

/** Render a bare freeform rich-text field backed by Markdown. */
export function FreeformTextEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
  readOnly = false,
  onSubmit,
  onCancel,
  className,
  mentionOrgId,
}: FreeformTextEditorProps): JSX.Element | null {
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  onCancelRef.current = onCancel;

  // `/` and `@` are separate runs on purpose. Slash inserts a block and never leaves the
  // document, so it stays on the plugin that owns it. Mentions reach across workspaces and
  // connected apps, so they ride the controller that knows how to search and hydrate them.
  const slash = useSlashCommands({ disabled: disabled || readOnly });
  const slashExtensions = slash.extensions;
  const attachSlash = slash.attach;
  const slashMenu = slash.menu;

  const mentions = useMentionController({
    orgId: mentionOrgId,
    enabled: mentionOrgId !== undefined && !readOnly && !disabled,
  });
  // `useEditor`'s callbacks are created once and close over their first render's values, the same
  // reason `onChangeRef` exists a few lines up. The controller changes every keystroke, so the
  // handlers must reach it through a ref or they would act on a stale menu.
  const mentionsRef = useRef(mentions);
  mentionsRef.current = mentions;

  // Announced politely rather than rendered as text, so a screen-reader user learns that Tab is
  // temporarily bound without a stray fragment appearing mid-sentence.
  const [linkOffer, setLinkOffer] = useState<PendingLinkUpgrade | undefined>(undefined);
  const editorRef = useRef<Editor | null>(null);

  const upgradeLink = useCallback((pending: PendingLinkUpgrade): boolean => {
    const instance = editorRef.current;
    if (instance === null) return false;
    const label = instance.state.doc.textBetween(pending.from, pending.to, ' ');
    instance
      .chain()
      .focus()
      .insertContentAt({ from: pending.from, to: pending.to }, [
        {
          type: MENTION_NODE,
          attrs: attributesFromRef(
            { kind: 'external', url: pending.href },
            // The pasted URL until hydration resolves a real title; a chip that renders blank
            // while waiting would be worse than one that renders the link.
            label === '' ? pending.href : label,
            pending.href,
          ),
        },
        { type: 'text', text: ' ' },
      ])
      .run();
    return true;
  }, []);

  const upgradeLinkRef = useRef(upgradeLink);
  upgradeLinkRef.current = upgradeLink;
  const setLinkOfferRef = useRef(setLinkOffer);
  setLinkOfferRef.current = setLinkOffer;

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['mailto'],
        // App-relative hrefs must pass, or an internal mention round-trips into a link Tiptap
        // rejects and silently degrades to plain text — losing the reference with no error.
        validate: (href) => /^(https?:|mailto:|\/)/i.test(href),
      }),
      createMentionExtension(() => ReactNodeViewRenderer(MentionNodeView)),
      createLinkUpgradeExtension({
        onUpgrade: (pending) => upgradeLinkRef.current(pending),
        onPendingChange: (pending) => {
          setLinkOfferRef.current(pending);
        },
      }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      ...slashExtensions,
    ],
    [slashExtensions],
  );

  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    editable: !disabled && !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        'data-placeholder': placeholder,
        role: 'textbox',
        class:
          'text-on-surface text-body-large min-h-10 w-full cursor-text font-normal outline-none [&_a:not([data-mention-kind])]:text-primary [&_a:not([data-mention-kind])]:underline [&_blockquote]:border-outline-variant [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:bg-surface-container-high [&_code]:rounded [&_code]:px-1 [&_h1]:text-title-large [&_h1]:mt-6 [&_h1]:font-medium [&_h2]:text-title-medium [&_h2]:mt-5 [&_h2]:font-medium [&_h3]:text-title-small [&_h3]:mt-4 [&_h3]:font-medium [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:bg-surface-container-high [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
      },
      handleKeyDown: (view, event) => {
        // First, because ProseMirror consults `editorProps.handleKeyDown` before any plugin
        // keymap: if the menu's Escape did not run here it would never run at all, and Escape
        // would discard the draft instead of dismissing the menu.
        if (mentionsRef.current.handleKeyDown(view, event)) return true;
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && onSubmitRef.current) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        if (event.key === 'Escape' && onCancelRef.current) {
          event.preventDefault();
          onCancelRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current(instance.getMarkdown());
      mentionsRef.current.syncFromEditor(instance);
    },
    onSelectionUpdate: ({ editor: instance }) => {
      mentionsRef.current.syncFromEditor(instance);
    },
    onCreate: ({ editor: instance }) => {
      editorRef.current = instance;
    },
  });

  attachSlash(editor);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled && !readOnly);
  }, [editor, disabled, readOnly]);

  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    // Replacing content destroys the selection, which closes the menu mid-word. A controlled
    // parent that normalizes markdown would otherwise make the picker unusable in composers.
    if (mentions.suppressReconcile.current) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value, mentions.suppressReconcile]);

  if (!editor) return null;

  return (
    <div
      data-editor-surface=""
      onMouseDown={(event) => {
        // Click anywhere the surface *looks* editable and the caret goes there — including the
        // empty space to the right of a line and the whitespace below the last paragraph. The
        // ProseMirror element only covers its own text, so without this a person clicking the
        // obvious blank area inside an editor-shaped box gets nothing at all.
        if (!editor.isEditable) return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        editor.commands.focus('end');
      }}
      className={cn(
        'placeholder:text-on-surface-variant [&_.ProseMirror.is-editor-empty:first-child::before]:text-on-surface-variant [&_.ProseMirror]:min-h-10 [&_.ProseMirror]:outline-none [&_.ProseMirror.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror.is-editor-empty:first-child::before]:float-left [&_.ProseMirror.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
        editor.isEditable ? 'cursor-text' : '',
        disabled ? 'cursor-default opacity-60' : '',
        className,
      )}
    >
      <EditorContent
        editor={editor}
        aria-expanded={mentions.open}
        aria-controls={mentions.open ? mentions.listboxId : undefined}
        aria-activedescendant={mentions.open ? mentions.activeKey : undefined}
      />
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {linkOffer === undefined ? '' : 'Link pasted. Press Tab to turn it into a chip.'}
      </p>
      {mentions.open ? (
        <MentionMenu
          open={mentions.open}
          orgId={mentionOrgId ?? ''}
          anchorRef={mentions.anchorRef}
          activeKey={mentions.activeKey}
          hasArrowed={mentions.hasArrowed}
          listboxId={mentions.listboxId}
          query={mentions.query}
          onSelect={mentions.selectItem}
          onRows={mentions.reportRows}
          onOpenChange={(next) => {
            if (!next) mentions.dismiss();
          }}
        />
      ) : null}
      {slashMenu}
    </div>
  );
}

/** Props for {@link FreeformText}. */
export interface FreeformTextProps {
  /** Markdown content to render. */
  value: string;
  /** Empty-state text when no content exists. */
  emptyText: string;
  /** Additional container styling. */
  className?: string;
}

/** Render stored Markdown as the same quiet text surface without editing controls. */
export function FreeformText({ value, emptyText, className }: FreeformTextProps): JSX.Element {
  const activeOrgId = useActiveOrgIdOptional();
  if (value.trim().length === 0) {
    return <p className={cn('text-on-surface-variant text-body-medium', className)}>{emptyText}</p>;
  }
  // Read-only, but still wrapped: a reader's chips need their previews resolved just as much as
  // an author's, and the batch provider is what keeps that one request instead of one per chip.
  const editor = (
    <FreeformTextEditor
      value={value}
      onChange={() => undefined}
      placeholder=""
      ariaLabel="Description"
      readOnly
      className={className}
    />
  );
  return activeOrgId === null ? (
    editor
  ) : (
    <MentionHydrationProvider orgId={activeOrgId}>{editor}</MentionHydrationProvider>
  );
}

/** Props for {@link EditableFreeformText}. */
export interface EditableFreeformTextProps {
  /** Persisted Markdown value, or null for no description. */
  value: string | null | undefined;
  /** Empty-state prompt shown while the field is empty. */
  placeholder: string;
  /** Whether the viewer may edit the body. */
  canEdit: boolean;
  /** Persist a non-empty Markdown value or null to clear the description. Called on autosave. */
  onSave: (value: string | null) => void;
  /** Additional wrapper styling. */
  className?: string;
}

/** A document body that autosaves on a debounce instead of exposing a Save button. */
export function EditableFreeformText({
  value,
  placeholder,
  canEdit,
  onSave,
  className,
}: EditableFreeformTextProps): JSX.Element {
  const activeOrgId = useActiveOrgIdOptional();
  const [draft, setDraft] = useState(value ?? '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value ?? '');
  }, [value, focused]);

  useDebouncedAutosave({
    value: draft,
    baseline: value ?? '',
    save: (next) => {
      const trimmed = next.trim();
      onSave(trimmed.length > 0 ? trimmed : null);
    },
  });

  if (!canEdit)
    return <FreeformText value={value ?? ''} emptyText={placeholder} className={className} />;

  return (
    <div
      className={cn('flex min-h-0 flex-col', className)}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
    >
      {activeOrgId === null ? (
        <FreeformTextEditor
          value={draft}
          onChange={setDraft}
          placeholder={placeholder}
          ariaLabel="Description"
          className="flex min-h-28 flex-1 flex-col [&>div]:flex-1"
        />
      ) : (
        <MentionHydrationProvider orgId={activeOrgId}>
          <FreeformTextEditor
            value={draft}
            onChange={setDraft}
            placeholder={placeholder}
            ariaLabel="Description"
            className="flex min-h-28 flex-1 flex-col [&>div]:flex-1"
            mentionOrgId={activeOrgId}
          />
        </MentionHydrationProvider>
      )}
    </div>
  );
}
