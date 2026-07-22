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
import StarterKit from '@tiptap/starter-kit';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@docket/ui/lib/utils';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

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
}: FreeformTextEditorProps): JSX.Element | null {
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  onCancelRef.current = onCancel;

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['mailto'],
        validate: (href) => /^(https?:|mailto:)/i.test(href),
      }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    [],
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
          'text-on-surface text-body-large min-h-10 w-full cursor-text font-normal outline-none [&_a]:text-primary [&_a]:underline [&_blockquote]:border-outline-variant [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:bg-surface-container-high [&_code]:rounded [&_code]:px-1 [&_h1]:text-title-large [&_h1]:mt-6 [&_h1]:font-medium [&_h2]:text-title-medium [&_h2]:mt-5 [&_h2]:font-medium [&_h3]:text-title-small [&_h3]:mt-4 [&_h3]:font-medium [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:bg-surface-container-high [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
      },
      handleKeyDown: (_view, event) => {
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
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled && !readOnly);
  }, [editor, disabled, readOnly]);

  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        'placeholder:text-on-surface-variant [&_.ProseMirror.is-editor-empty:first-child::before]:text-on-surface-variant [&_.ProseMirror]:min-h-10 [&_.ProseMirror]:outline-none [&_.ProseMirror.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror.is-editor-empty:first-child::before]:float-left [&_.ProseMirror.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
        disabled ? 'cursor-default opacity-60' : '',
        className,
      )}
    >
      <EditorContent editor={editor} />
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
  if (value.trim().length === 0) {
    return <p className={cn('text-on-surface-variant text-body-medium', className)}>{emptyText}</p>;
  }
  return (
    <FreeformTextEditor
      value={value}
      onChange={() => undefined}
      placeholder=""
      ariaLabel="Description"
      readOnly
      className={className}
    />
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
  /** Whether the host's autosave mutation is currently in flight. */
  saving?: boolean;
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
  saving = false,
  onSave,
  className,
}: EditableFreeformTextProps): JSX.Element {
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
      className={cn('flex flex-col gap-1', className)}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
    >
      <FreeformTextEditor
        value={draft}
        onChange={setDraft}
        placeholder={placeholder}
        ariaLabel="Description"
        disabled={saving}
        className="min-h-28"
      />
      <span className="text-on-surface-variant text-xs">{saving ? 'Saving…' : ''}</span>
    </div>
  );
}
