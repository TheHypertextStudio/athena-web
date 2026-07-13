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
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@docket/ui/lib/utils';

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
        'data-placeholder': placeholder,
        class:
          'text-on-surface text-body min-h-10 w-full cursor-text outline-none [&_a]:text-primary [&_a]:underline [&_blockquote]:border-outline-variant [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:bg-surface-container-high [&_code]:rounded [&_code]:px-1 [&_h1]:text-h2 [&_h1]:mt-4 [&_h1]:font-semibold [&_h2]:text-h3 [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:bg-surface-container-high [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
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
    return <p className={cn('text-on-surface-variant text-body', className)}>{emptyText}</p>;
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
  /** Empty-state prompt used before editing begins. */
  placeholder: string;
  /** Whether the viewer may enter editing mode. */
  canEdit: boolean;
  /** Disable controls while the host save is in flight. */
  saving?: boolean;
  /** Persist a non-empty Markdown value or null to clear the description. */
  onSave: (value: string | null) => void;
  /** Additional wrapper styling. */
  className?: string;
}

/** A description that reads as normal text until someone chooses to edit it. */
export function EditableFreeformText({
  value,
  placeholder,
  canEdit,
  saving = false,
  onSave,
  className,
}: EditableFreeformTextProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const save = (): void => {
    const next = draft.trim();
    onSave(next.length > 0 ? next : null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <FreeformTextEditor
          value={draft}
          onChange={setDraft}
          placeholder={placeholder}
          ariaLabel="Description"
          disabled={saving}
          onSubmit={save}
          onCancel={() => {
            setDraft(value ?? '');
            setEditing(false);
          }}
          className="min-h-28"
        />
        <div className="flex items-center gap-2">
          <span className="text-on-surface-variant mr-auto text-xs">
            ⌘↵ to save · Esc to discard
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setDraft(value ?? '');
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  if (!canEdit)
    return <FreeformText value={value ?? ''} emptyText={placeholder} className={className} />;

  return (
    <button
      type="button"
      onClick={() => {
        setEditing(true);
      }}
      className={cn(
        'hover:bg-surface-container-low focus-visible:ring-ring -mx-2 rounded-md px-2 py-1 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      <FreeformText value={value ?? ''} emptyText={placeholder} />
    </button>
  );
}
