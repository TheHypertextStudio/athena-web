'use client';

import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { Copy, Ellipsis, TableRows, ViewColumn } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  menuDestructiveItem,
} from '@docket/ui/primitives';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { JSX, Ref } from 'react';

import { useCopyFeedback } from '@/lib/use-copy-feedback';

import { tableClipboardPayload } from './table-clipboard';

/** Props for the contextual Markdown table controls. */
export interface TableControlsProps {
  /** The shared editor whose current table receives each command. */
  readonly editor: Editor;
  /** The owning editor uses this handle for its Alt+F10 focus transfer. */
  readonly controlsRef?: Ref<HTMLDivElement> | undefined;
}

/** DOM owners that keep the table rail visible, positioned, and inside its modal boundary. */
interface TableControlsEnvironment {
  readonly portalHost: HTMLElement;
  readonly collisionBoundary: HTMLElement | undefined;
  readonly scrollTarget: HTMLElement | Window;
}

/** Resolve the visible perimeter of the table that owns the current caret. */
function activeTablePerimeter(editor: Editor): HTMLElement | null {
  const { node } = editor.view.domAtPos(editor.state.selection.from);
  const element = node instanceof Element ? node : node.parentElement;
  const table = element?.closest<HTMLTableElement>('table');
  return table?.closest<HTMLElement>('.tableWrapper') ?? table ?? null;
}

/** Find the closest ancestor whose vertical scrolling moves the editor. */
function nearestScrollTarget(editor: Editor): HTMLElement | Window {
  let ancestor = editor.view.dom.parentElement;
  while (ancestor !== null) {
    const style = window.getComputedStyle(ancestor);
    if (/auto|scroll|overlay/.test(`${style.overflow} ${style.overflowY}`)) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return window;
}

/** Render the small action rail shown while the caret sits in a table. */
export function TableControls({ editor, controlsRef }: TableControlsProps): JSX.Element | null {
  const [environment, setEnvironment] = useState<TableControlsEnvironment | null>(null);
  const activePerimeterRef = useRef<HTMLElement | null>(null);
  const tableMenuId = useId();
  const clearActivePerimeter = useCallback((): void => {
    activePerimeterRef.current?.removeAttribute('data-table-controls-visible');
    activePerimeterRef.current = null;
  }, []);
  useEffect(() => {
    const collisionBoundary = editor.view.dom.closest<HTMLElement>('[role="dialog"]') ?? undefined;
    const portalOwner = collisionBoundary ?? document.body;
    const portalHost = document.createElement('div');
    portalHost.setAttribute('data-table-controls-portal', '');
    portalOwner.append(portalHost);
    const hideWhenInteractionMovesOutside = (target: EventTarget | null): void => {
      if (
        target instanceof Node &&
        (portalHost.contains(target) || editor.view.dom.contains(target))
      ) {
        return;
      }
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta('docketTableControls', 'hide'));
      }
      clearActivePerimeter();
    };
    const hideWhenFocusMovesOutside = (event: FocusEvent): void => {
      hideWhenInteractionMovesOutside(event.target);
    };
    const hideWhenPointerStartsOutside = (event: PointerEvent): void => {
      hideWhenInteractionMovesOutside(event.target);
    };
    document.addEventListener('focusin', hideWhenFocusMovesOutside);
    document.addEventListener('pointerdown', hideWhenPointerStartsOutside, true);
    setEnvironment({
      portalHost,
      collisionBoundary,
      scrollTarget: nearestScrollTarget(editor),
    });
    return () => {
      document.removeEventListener('focusin', hideWhenFocusMovesOutside);
      document.removeEventListener('pointerdown', hideWhenPointerStartsOutside, true);
      portalHost.remove();
    };
  }, [clearActivePerimeter, editor]);
  const resolveActivePerimeter = (): HTMLElement | null => {
    const perimeter = activeTablePerimeter(editor);
    if (perimeter === activePerimeterRef.current) return perimeter;
    clearActivePerimeter();
    perimeter?.setAttribute('data-table-controls-visible', '');
    activePerimeterRef.current = perimeter;
    return perimeter;
  };
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

  if (environment === null) return null;

  return (
    <BubbleMenu
      ref={controlsRef}
      editor={editor}
      pluginKey="docketTableControls"
      updateDelay={0}
      shouldShow={({ editor: current, element, view }) =>
        current.isEditable &&
        current.isActive('table') &&
        (view.hasFocus() ||
          element.contains(document.activeElement) ||
          (document.activeElement instanceof Element &&
            document.activeElement
              .closest('[data-editor-table-menu]')
              ?.getAttribute('data-editor-table-menu') === tableMenuId))
      }
      appendTo={environment.portalHost}
      getReferencedVirtualElement={resolveActivePerimeter}
      options={{
        placement: 'top-start',
        offset: 8,
        strategy: 'absolute',
        scrollTarget: environment.scrollTarget,
        onHide: clearActivePerimeter,
        onDestroy: clearActivePerimeter,
      }}
      role="toolbar"
      aria-label="Table controls"
      aria-keyshortcuts="Alt+F10"
      data-table-controls=""
      contentEditable={false}
      className="border-outline-variant bg-surface-container-high shadow-level2 z-[120] flex max-w-[calc(100vw-2rem)] flex-nowrap items-center gap-0.5 rounded-xl border p-1"
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
          <TableRows aria-hidden="true" className="size-4" />
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
          <ViewColumn aria-hidden="true" className="size-4" />
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
          <DropdownMenuContent
            align="end"
            {...(environment.collisionBoundary === undefined
              ? {}
              : { collisionBoundary: environment.collisionBoundary })}
            portalContainer={environment.portalHost}
            data-editor-table-menu={tableMenuId}
          >
            <DropdownMenuItem
              onSelect={() => {
                editor.chain().focus().addRowAfter().run();
              }}
            >
              <TableRows aria-hidden="true" />
              Add row
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                editor.chain().focus().addColumnAfter().run();
              }}
            >
              <ViewColumn aria-hidden="true" />
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
