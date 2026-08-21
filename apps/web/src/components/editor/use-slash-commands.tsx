'use client';

/**
 * `/` for any editor — one hook that owns the run, its menu, and its keyboard.
 *
 * @remarks
 * Kept out of the editor component so every editor surface (a project brief, a task description,
 * a comment) gets identical behaviour by calling one hook rather than by copying wiring. The hook
 * owns the plugin, the open run, the highlighted row and the keyboard; the caller only renders
 * `menu` and passes `extensions` through to Tiptap.
 *
 * This hook used to own `@` as well. It no longer does. A slash command inserts a block and never
 * leaves the document, so a flat list ranked by name is the whole interaction. A mention reaches
 * across the workspace and into connected apps, which needs two search waves on different
 * deadlines, results grouped by kind, and a hovercard — none of which a flat list can express.
 * Splitting them let each keep the interaction it actually wants; see `use-mention-controller`.
 *
 * The keyboard contract matches every other list in the product: ↑/↓ move, Home/End jump, Enter
 * and Tab take the highlighted row, Escape dismisses and leaves the typed text alone. Those keys
 * are claimed *only while a run is open*, so an editor with no menu showing still gets plain
 * Enter, plain Tab and plain Escape.
 */
import { Extension, type AnyExtension, type Editor } from '@tiptap/react';
import { type JSX, useCallback, useId, useMemo, useRef, useState } from 'react';

import { rankSlashCommands, type SlashCommand } from './slash-commands';
import { createSuggestionPlugin, type SuggestionRun } from './suggestion-plugin';
import { SuggestionMenu, type SuggestionItem } from './suggestion-menu';

/** Options for {@link useSlashCommands}. */
export interface SlashCommandsOptions {
  /** Turn the whole feature off (read-only editors, disabled fields). */
  readonly disabled?: boolean;
  /** Feature-owned commands to dispatch through the same menu and keyboard contract. */
  readonly commands?: readonly SlashCommand[];
}

/** What {@link useSlashCommands} returns. */
export interface SlashCommands {
  /** Tiptap extensions to append to the editor's list. Stable across renders. */
  readonly extensions: readonly AnyExtension[];
  /** Hand the hook the editor instance once Tiptap has created it. */
  readonly attach: (editor: Editor | null) => void;
  /** The floating menu, or `null` when no run is open. */
  readonly menu: JSX.Element | null;
  /** True while the menu is open, so the host can mark the editor `aria-expanded`. */
  readonly isOpen: boolean;
  /** Id of the owned listbox, for the host editor's `aria-controls`. */
  readonly listboxId: string;
  /** Id of the highlighted option, for the host editor's `aria-activedescendant`. */
  readonly activeKey: string | undefined;
}

/**
 * Wire `/` into an editor.
 *
 * @param options - The {@link SlashCommandsOptions}.
 * @returns The {@link SlashCommands} bundle.
 */
export function useSlashCommands(options: SlashCommandsOptions = {}): SlashCommands {
  const { disabled = false, commands = [] } = options;
  const instanceId = useId();
  const listboxId = `editor-slash-menu-${instanceId}`;
  const editorRef = useRef<Editor | null>(null);
  const [run, setRun] = useState<SuggestionRun | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  /** The visible options are read through a ref so the plugin's keydown sees the current list. */
  const itemsRef = useRef<readonly { id: string; take: () => void }[]>([]);
  const runRef = useRef<SuggestionRun | null>(null);
  const activeIndexRef = useRef(0);
  const dismissRef = useRef<((from: number) => void) | null>(null);
  runRef.current = run;
  activeIndexRef.current = activeIndex;

  const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
    const current = runRef.current;
    if (current === null) return false;
    const items = itemsRef.current;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => (items.length === 0 ? 0 : (index + 1) % items.length));
        return true;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) =>
          items.length === 0 ? 0 : (index - 1 + items.length) % items.length,
        );
        return true;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        return true;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(items.length - 1, 0));
        return true;
      case 'Enter':
      case 'Tab': {
        const chosen = items[activeIndexRef.current];
        if (!chosen) return false;
        event.preventDefault();
        chosen.take();
        return true;
      }
      case 'Escape':
        event.preventDefault();
        dismissRef.current?.(current.from);
        setRun(null);
        return true;
      default:
        return false;
    }
  }, []);

  const plugins = useMemo(() => {
    const slash = createSuggestionPlugin({
      pluginName: 'docketSlashSuggestion',
      trigger: '/',
      startOfBlockOnly: true,
      maxQueryLength: 24,
      onChange: (next) => {
        setRun(next);
        if (next !== null) setActiveIndex(0);
      },
      onKeyDown: handleKeyDown,
    });
    dismissRef.current = (from) => {
      const view = editorRef.current?.view;
      if (view) slash.dismiss(view, from);
    };
    return [slash.plugin];
    // The plugin is created once per hook instance; `handleKeyDown` is itself stable.
  }, [handleKeyDown]);

  const extensions = useMemo<readonly AnyExtension[]>(
    () =>
      disabled
        ? []
        : [
            Extension.create({
              name: 'docketSlashCommands',
              addProseMirrorPlugins: () => plugins,
            }),
          ],
    [plugins, disabled],
  );

  const runSlash = useCallback((command: SlashCommand): void => {
    const editor = editorRef.current;
    const current = runRef.current;
    if (!editor || current === null) return;
    command.run(editor, { from: current.from, to: current.to });
    setRun(null);
  }, []);

  const items = useMemo<readonly SuggestionItem[]>(
    () =>
      run === null
        ? []
        : rankSlashCommands(run.query, commands).map((command) => ({
            id: command.id,
            label: command.label,
            hint: command.hint,
            icon: command.icon,
          })),
    [run, commands],
  );

  const takers = useMemo(
    () =>
      run === null
        ? []
        : rankSlashCommands(run.query, commands).map((command) => ({
            id: command.id,
            take: () => {
              runSlash(command);
            },
          })),
    [run, runSlash, commands],
  );
  itemsRef.current = takers;

  const menu =
    run === null ? null : (
      <SuggestionMenu
        anchor={run.rect}
        items={items}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        onSelect={(index) => {
          takers[index]?.take();
        }}
        emptyText="No block matches that."
        ariaLabel="Insert a block"
        listboxId={listboxId}
      />
    );

  return {
    extensions,
    attach: (editor) => {
      editorRef.current = editor;
    },
    menu,
    isOpen: run !== null,
    listboxId,
    activeKey:
      run === null || items[activeIndex] === undefined
        ? undefined
        : `${listboxId}-${items[activeIndex].id}`,
  };
}
