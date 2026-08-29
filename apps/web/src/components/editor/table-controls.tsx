'use client';

import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { Copy, Ellipsis, Plus } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  menuDestructiveItem,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useCopyFeedback } from '@/lib/use-copy-feedback';

import { tableClipboardPayload } from './table-clipboard';

/** Props for the contextual Markdown table controls. */
export interface TableControlsProps {
  /** The shared editor whose current table receives each command. */
  readonly editor: Editor;
}

/** Render the small action rail shown while the caret sits in a table. */
export function TableControls({ editor }: TableControlsProps): JSX.Element {
  const {
    state: copyState,
    announcement,
    copy,
    copyText,
    report,
  } = useCopyFeedback({
    copiedMessage: 'Table copied.',
    failedMessage: 'Could not copy the table. Try again.',
  });

  const payload = () => tableClipboardPayload(editor);
  const copyTable = (): void => {
    const value = payload();
    if (value === null) {
      report(false);
      return;
    }
    void copy({ html: value.html, text: value.markdown });
  };
  const copyMarkdown = (): void => {
    const value = payload();
    if (value === null) {
      report(false);
      return;
    }
    void copyText(value.markdown);
  };
  const copyCsv = (): void => {
    const value = payload();
    if (value === null) {
      report(false);
      return;
    }
    void copyText(value.csv);
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="docketTableControls"
      updateDelay={0}
      shouldShow={({ editor: current, element, view }) =>
        current.isEditable &&
        current.isActive('table') &&
        (view.hasFocus() || element.contains(document.activeElement))
      }
      options={{ placement: 'top-start', offset: 8 }}
      role="toolbar"
      aria-label="Table controls"
      aria-keyshortcuts="Alt+F10"
      data-table-controls=""
      contentEditable={false}
      className="border-outline-variant bg-surface-container-high flex max-w-[calc(100vw-2rem)] flex-nowrap items-center gap-0.5 rounded-xl border p-1"
    >
      <div
        onKeyDownCapture={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          editor.commands.focus();
        }}
        className="contents"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 max-sm:min-h-10"
          onClick={() => {
            editor.chain().focus().addRowAfter().run();
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add row
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 max-[350px]:hidden max-sm:min-h-10"
          onClick={() => {
            editor.chain().focus().addColumnAfter().run();
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add column
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Copy table"
          data-copy-state={copyState}
          className="shrink-0 max-[420px]:hidden max-sm:min-h-10"
          onClick={copyTable}
        >
          <Copy aria-hidden="true" className="size-4" />
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Retry' : 'Copy'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Table options"
              className="shrink-0 max-sm:min-h-10 max-sm:min-w-10"
            >
              <Ellipsis aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-editor-table-menu="">
            <DropdownMenuItem
              onSelect={() => {
                editor.chain().focus().addRowAfter().run();
              }}
            >
              Add row
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                editor.chain().focus().addColumnAfter().run();
              }}
            >
              Add column
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={copyTable}>Copy table</DropdownMenuItem>
            <DropdownMenuItem onSelect={copyMarkdown}>Copy as Markdown</DropdownMenuItem>
            <DropdownMenuItem onSelect={copyCsv}>Copy as CSV</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={menuDestructiveItem()}
              onSelect={() => {
                editor.chain().focus().deleteRow().run();
              }}
            >
              Delete row
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuDestructiveItem()}
              onSelect={() => {
                editor.chain().focus().deleteColumn().run();
              }}
            >
              Delete column
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuDestructiveItem()}
              onSelect={() => {
                editor.chain().focus().deleteTable().run();
              }}
            >
              Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </p>
      </div>
    </BubbleMenu>
  );
}
