'use client';

/**
 * A quiet rich-text surface that persists as Markdown without exposing Markdown as a UI mode.
 *
 * @remarks
 * There is deliberately no toolbar, source toggle, or document chrome. Familiar keyboard input
 * and Markdown shortcuts work in place; the host only receives serialized Markdown on save.
 */
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
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

import { useDocumentImageUpload } from '@/lib/use-document-image-upload';

import { useSlashCommands } from './use-slash-commands';
import { createCodeBlockExtension } from './code-block-extension';
import CodeBlockNodeView from './code-block-node-view';
import { createMarkdownClipboardExtension } from './markdown-clipboard';
import { createTaskListShortcutExtension } from './task-list-shortcut';

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
  disabled?: boolean | undefined;
  /** Keep the rendered document readable while preventing edits. */
  readOnly?: boolean | undefined;
  /** Called by Cmd/Ctrl+Enter when the host supports an explicit save action. */
  onSubmit?: (() => void) | undefined;
  /** Called by Escape when the host supports cancelling an edit. */
  onCancel?: (() => void) | undefined;
  /** Additional styling for the editor container. */
  className?: string | undefined;
  /**
   * The organization whose entities and connected apps `@` can reference.
   *
   * @remarks
   * Absent means mentions are off for this surface, which is the right default for a field with
   * no workspace context rather than a reason to guess one.
   */
  mentionOrgId?: string | undefined;
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
  // React may deliver controlled values one or more editor transactions late. Keep a bounded
  // journal so those self-echoes cannot replace newer ProseMirror content mid-keystroke.
  const pendingLocalValuesRef = useRef<string[]>([]);
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

  // Pasted images are stored in whichever workspace the reader is in. `mentionOrgId` is only set on
  // surfaces that opted into mentions, so the active workspace is the broader fallback — a body in
  // a personal space still needs somewhere to put a screenshot.
  const activeOrgId = useActiveOrgIdOptional();
  const images = useDocumentImageUpload(mentionOrgId ?? activeOrgId ?? undefined);
  // Through a ref, because the editor is created once: an extension's options are captured at
  // creation and `useEditor` never rebuilds it, so a surface that mounted before its workspace
  // resolved would hold `null` forever and silently drop every pasted screenshot.
  const uploadImageRef = useRef(images.upload);
  uploadImageRef.current = images.upload;
  const resolveUploader = useCallback(() => uploadImageRef.current, []);
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
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        codeBlock: false,
        code: { HTMLAttributes: { 'data-inline-code': '' } },
      }),
      createCodeBlockExtension(ReactNodeViewRenderer(CodeBlockNodeView)),
      TaskList,
      TaskItem.configure({ nested: true }),
      // `- [ ] ` is the Markdown spelling bodies are stored in; see the extension's remarks.
      createTaskListShortcutExtension(),
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
      // Registered so content arriving from another editor keeps its shape. All three ship their
      // own Markdown hooks, so a pasted table, image, or underline survives the round trip through
      // the Markdown the body is stored as rather than being dropped by the schema.
      TableKit,
      Image,
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      // After Markdown: the clipboard extension reads the manager that extension installs.
      createMarkdownClipboardExtension({ resolveUploader }),
      // `showOnlyWhenEditable` (the default) already keeps this silent for the read-only instance
      // below — that one never reaches an empty document anyway, since `FreeformText` renders its
      // own `<p>{emptyText}</p>` instead of mounting an editor over nothing to prompt into.
      Placeholder.configure({ placeholder }),
      ...slashExtensions,
    ],
    [slashExtensions, resolveUploader, placeholder],
  );

  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    editable: !disabled && !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        ...(readOnly
          ? { role: 'document' }
          : { 'aria-label': ariaLabel, 'aria-multiline': 'true', role: 'textbox' }),
        class:
          "text-on-surface text-body-medium min-h-10 w-full cursor-text font-normal outline-none [&_a:not([data-mention-kind])]:text-primary [&_a:not([data-mention-kind])]:underline [&_blockquote]:border-outline-variant [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_[data-inline-code]]:border-outline-variant [&_[data-inline-code]]:bg-surface-container-high [&_[data-inline-code]]:rounded [&_[data-inline-code]]:border [&_[data-inline-code]]:px-1.5 [&_[data-inline-code]]:py-0.5 [&_[data-inline-code]]:font-mono [&_.hljs-keyword]:text-primary [&_.hljs-built_in]:text-primary [&_.hljs-type]:text-primary [&_.hljs-selector-tag]:text-primary [&_.hljs-title]:text-secondary [&_.hljs-function]:text-secondary [&_.hljs-section]:text-secondary [&_.hljs-string]:text-tertiary [&_.hljs-attr]:text-tertiary [&_.hljs-addition]:text-tertiary [&_.hljs-number]:text-secondary [&_.hljs-literal]:text-secondary [&_.hljs-symbol]:text-secondary [&_.hljs-comment]:text-on-surface-variant [&_.hljs-quote]:text-on-surface-variant [&_.hljs-meta]:text-on-surface-variant [&_.hljs-deletion]:text-error [&_h1]:text-title-large [&_h1]:mt-6 [&_h1]:font-medium [&_h2]:text-title-large [&_h2]:mt-5 [&_h3]:text-title-medium [&_h3]:mt-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_table]:my-3 [&_table]:min-w-full [&_td]:border-outline-variant [&_td]:border [&_td]:p-2 [&_th]:border-outline-variant [&_th]:border [&_th]:p-2 [&_th]:text-left [&_th]:text-label-large [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul[data-type='taskList']]:my-2 [&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:pl-0 [&_ul[data-type='taskList']_ul[data-type='taskList']]:my-0 [&_ul[data-type='taskList']_ul[data-type='taskList']]:pl-6 [&_ul[data-type='taskList']_li[data-checked]]:flex [&_ul[data-type='taskList']_li[data-checked]]:items-start [&_ul[data-type='taskList']_li[data-checked]]:gap-2 [&_ul[data-type='taskList']_li[data-checked]]:my-1 [&_ul[data-type='taskList']_li[data-checked]>label]:relative [&_ul[data-type='taskList']_li[data-checked]>label]:mt-0.5 [&_ul[data-type='taskList']_li[data-checked]>label]:flex [&_ul[data-type='taskList']_li[data-checked]>label]:shrink-0 [&_ul[data-type='taskList']_li[data-checked]>label]:cursor-pointer [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:border-outline [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:size-4 [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:shrink-0 [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:cursor-pointer [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:appearance-none [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:rounded-[0.1875rem] [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:border-2 [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:bg-transparent [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']]:transition-colors [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']:checked]:border-primary [&_ul[data-type='taskList']_li[data-checked]_input[type='checkbox']:checked]:bg-primary [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:border-on-primary [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:pointer-events-none [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:absolute [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:top-[2px] [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:left-[5px] [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:h-[7px] [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:w-[3px] [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:rotate-45 [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:border-r-2 [&_ul[data-type='taskList']_li[data-checked]_input:checked+span]:border-b-2 [&_ul[data-type='taskList']_li[data-checked]>div]:min-w-0 [&_ul[data-type='taskList']_li[data-checked]>div]:flex-1 [&_ul[data-type='taskList']_li[data-checked]>div_p]:my-0 [&_ul[data-type='taskList']_li[data-checked][data-checked='true']>div]:text-on-surface-variant [&_ul[data-type='taskList']_li[data-checked][data-checked='true']>div]:line-through [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
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
      const next = instance.getMarkdown();
      const pending = pendingLocalValuesRef.current;
      if (pending.at(-1) !== next) {
        pending.push(next);
        if (pending.length > 100) pending.splice(0, pending.length - 100);
      }
      onChangeRef.current(next);
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
    if (!editor) return;
    if (editor.getMarkdown() === value) {
      pendingLocalValuesRef.current = [];
      return;
    }
    // Replacing content destroys the selection, which closes the menu mid-word. A controlled
    // parent that normalizes markdown would otherwise make the picker unusable in composers.
    if (mentions.suppressReconcile.current) return;
    const localEchoIndex = pendingLocalValuesRef.current.lastIndexOf(value);
    if (localEchoIndex >= 0) {
      pendingLocalValuesRef.current = pendingLocalValuesRef.current.slice(localEchoIndex + 1);
      return;
    }
    pendingLocalValuesRef.current = [];
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
        // `.ProseMirror_.is-editor-empty` (a descendant space, not a compound class): the
        // Placeholder extension decorates the empty *paragraph*, not the `.ProseMirror` root, so
        // `is-editor-empty` and `data-placeholder` land on that child node. A compound selector
        // here never matched anything — the placeholder text silently never rendered.
        'placeholder:text-on-surface-variant [&_.ProseMirror_.is-editor-empty:first-child::before]:text-on-surface-variant max-w-[75ch] [&_.ProseMirror]:min-h-10 [&_.ProseMirror]:outline-none [&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
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
      {images.status === 'failed' ? (
        <p className="text-error text-body-small mt-1">{images.announcement}</p>
      ) : null}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {images.announcement !== ''
          ? images.announcement
          : linkOffer === undefined
            ? ''
            : 'Link pasted. Press Tab to turn it into a chip.'}
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
  className?: string | undefined;
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

/**
 * A document body that treats continuous typing as one autosave session.
 *
 * @remarks
 * The draft persists after two seconds of quiet, or immediately when focus leaves the editor or
 * navigation unmounts it. Those explicit session boundaries keep a task's append-only activity
 * stream from recording partial sentences while preserving the latest text during navigation.
 */
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
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const updateDraft = useCallback((next: string): void => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  useEffect(() => {
    if (!focused) updateDraft(value ?? '');
  }, [value, focused, updateDraft]);

  const { flush } = useDebouncedAutosave({
    value: draft,
    baseline: value ?? '',
    delayMs: 2_000,
    save: (next) => {
      const trimmed = next.trim();
      onSave(trimmed.length > 0 ? trimmed : null);
    },
  });
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(
    () => () => {
      flushRef.current(draftRef.current);
    },
    [],
  );

  if (!canEdit)
    return <FreeformText value={value ?? ''} emptyText={placeholder} className={className} />;

  return (
    <div
      className={cn('flex min-h-0 flex-col', className)}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setFocused(false);
        flush(draftRef.current);
      }}
    >
      {activeOrgId === null ? (
        <FreeformTextEditor
          value={draft}
          onChange={updateDraft}
          placeholder={placeholder}
          ariaLabel="Description"
          className="flex min-h-28 flex-1 flex-col [&>div]:flex-1"
        />
      ) : (
        <MentionHydrationProvider orgId={activeOrgId}>
          <FreeformTextEditor
            value={draft}
            onChange={updateDraft}
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
