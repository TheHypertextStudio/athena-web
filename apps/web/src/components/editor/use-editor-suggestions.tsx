'use client';

/**
 * `@` and `/` for any editor — one hook that owns both runs, their menus, and their keyboard.
 *
 * @remarks
 * Kept out of the editor component so every editor surface (a project brief, a task description,
 * a comment) gets identical behaviour by calling one hook rather than by copying wiring. The
 * hook owns the plugin, the open run, the highlighted row and the keyboard; the caller only
 * renders `menu` and passes `extensions` through to Tiptap.
 *
 * The keyboard contract matches every other list in the product: ↑/↓ move, Home/End jump,
 * Enter and Tab take the highlighted row, Escape dismisses and leaves the typed text alone.
 * Those keys are claimed *only while a run is open*, so an editor with no menu showing still
 * gets plain Enter, plain Tab and plain Escape.
 */
import { Extension, type AnyExtension, type Editor } from '@tiptap/react';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';

import { AtSign, type LucideIcon } from '@docket/ui/icons';

import { rankMentions, useMentionDirectory } from './mention-directory';
import { mentionHref } from './mention-node';
import { rankSlashCommands, type SlashCommand } from './slash-commands';
import { createSuggestionPlugin, type SuggestionRun } from './suggestion-plugin';
import { SuggestionMenu, type SuggestionItem } from './suggestion-menu';

/** Options for {@link useEditorSuggestions}. */
export interface EditorSuggestionsOptions {
  /** The workspace whose objects can be mentioned, or `null` to disable mentions. */
  readonly organizationId: string | null;
  /** Turn the whole feature off (read-only editors, disabled fields). */
  readonly disabled?: boolean;
}

/** What {@link useEditorSuggestions} returns. */
export interface EditorSuggestions {
  /** Tiptap extensions to append to the editor's list. Stable across renders. */
  readonly extensions: readonly AnyExtension[];
  /** Hand the hook the editor instance once Tiptap has created it. */
  readonly attach: (editor: Editor | null) => void;
  /** The floating menu, or `null` when no run is open. */
  readonly menu: JSX.Element | null;
  /** True while a menu is open, so the host can mark the editor `aria-expanded`. */
  readonly isOpen: boolean;
}

/** The two runs this hook manages. */
type RunKind = 'mention' | 'slash';

/** Icons for the mention rows, by object kind. */
const MENTION_ICON: LucideIcon = AtSign;

/**
 * Wire `@` and `/` into an editor.
 *
 * @param options - The {@link EditorSuggestionsOptions}.
 * @returns The {@link EditorSuggestions} bundle.
 */
export function useEditorSuggestions(options: EditorSuggestionsOptions): EditorSuggestions {
  const { organizationId, disabled = false } = options;
  const editorRef = useRef<Editor | null>(null);
  const [run, setRun] = useState<{ kind: RunKind; run: SuggestionRun } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  /** The visible options are read through a ref so the plugin's keydown sees the current list. */
  const itemsRef = useRef<readonly { id: string; take: () => void }[]>([]);
  const runRef = useRef<{ kind: RunKind; run: SuggestionRun } | null>(null);
  const activeIndexRef = useRef(0);
  const dismissRef = useRef<{
    mention: ((from: number) => void) | null;
    slash: ((from: number) => void) | null;
  }>({
    mention: null,
    slash: null,
  });
  runRef.current = run;
  activeIndexRef.current = activeIndex;

  const directory = useMentionDirectory(organizationId, !disabled);

  const open = (kind: RunKind, next: SuggestionRun | null): void => {
    setRun((current) => {
      if (next === null) return current?.kind === kind ? null : current;
      return { kind, run: next };
    });
    if (next !== null) setActiveIndex(0);
  };

  const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
    const current = runRef.current;
    if (!current) return false;
    const items = itemsRef.current;
    const dismiss = dismissRef.current[current.kind];
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
        dismiss?.(current.run.from);
        setRun(null);
        return true;
      default:
        return false;
    }
  }, []);

  const plugins = useMemo(() => {
    const mention = createSuggestionPlugin({
      pluginName: 'docketMentionSuggestion',
      trigger: '@',
      maxQueryLength: 48,
      // Titles have spaces in them, so "@Launch check" must keep filtering; a double space or a
      // fifth word means the person went back to writing prose and the menu gets out of the way.
      maxWords: 4,
      onChange: (next) => {
        open('mention', next);
      },
      onKeyDown: handleKeyDown,
    });
    const slash = createSuggestionPlugin({
      pluginName: 'docketSlashSuggestion',
      trigger: '/',
      startOfBlockOnly: true,
      maxQueryLength: 24,
      onChange: (next) => {
        open('slash', next);
      },
      onKeyDown: handleKeyDown,
    });
    dismissRef.current = {
      mention: (from) => {
        const view = editorRef.current?.view;
        if (view) mention.dismiss(view, from);
      },
      slash: (from) => {
        const view = editorRef.current?.view;
        if (view) slash.dismiss(view, from);
      },
    };
    return [mention.plugin, slash.plugin];
    // The plugins are created once per hook instance; `handleKeyDown` is itself stable.
  }, [handleKeyDown]);

  const extensions = useMemo<readonly AnyExtension[]>(
    () => [
      Extension.create({
        name: 'docketSuggestions',
        addProseMirrorPlugins: () => plugins,
      }),
    ],
    [plugins],
  );

  const insertMention = useCallback(
    (entry: { kind: Parameters<typeof mentionHref>[0]; id: string; label: string }): void => {
      const editor = editorRef.current;
      const current = runRef.current;
      if (!editor || !current) return;
      editor
        .chain()
        .focus()
        .insertContentAt({ from: current.run.from, to: current.run.to }, [
          {
            type: 'mention',
            attrs: {
              kind: entry.kind,
              id: entry.id,
              label: entry.label,
              href: organizationId ? mentionHref(entry.kind, entry.id, organizationId) : null,
            },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
      setRun(null);
    },
    [organizationId],
  );

  const runSlash = useCallback((command: SlashCommand): void => {
    const editor = editorRef.current;
    const current = runRef.current;
    if (!editor || !current) return;
    command.run(editor, { from: current.run.from, to: current.run.to });
    setRun(null);
  }, []);

  const items = useMemo<readonly SuggestionItem[]>(() => {
    if (!run) return [];
    if (run.kind === 'slash') {
      return rankSlashCommands(run.run.query).map((command) => ({
        id: command.id,
        label: command.label,
        hint: command.hint,
        icon: command.icon,
      }));
    }
    return rankMentions(directory.entries, run.run.query).map((entry) => ({
      id: `${entry.kind}:${entry.id}`,
      label: entry.label,
      hint: entry.hint ?? entry.kind,
      icon: MENTION_ICON,
    }));
  }, [run, directory.entries]);

  const takers = useMemo(() => {
    if (!run) return [];
    if (run.kind === 'slash') {
      return rankSlashCommands(run.run.query).map((command) => ({
        id: command.id,
        take: () => {
          runSlash(command);
        },
      }));
    }
    return rankMentions(directory.entries, run.run.query).map((entry) => ({
      id: `${entry.kind}:${entry.id}`,
      take: () => {
        insertMention(entry);
      },
    }));
  }, [run, directory.entries, runSlash, insertMention]);
  itemsRef.current = takers;

  const menu =
    run === null ? null : (
      <SuggestionMenu
        anchor={run.run.rect}
        items={items}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        onSelect={(index) => {
          takers[index]?.take();
        }}
        emptyText={
          run.kind === 'slash'
            ? 'No block matches that.'
            : directory.isPending
              ? 'Looking through this workspace…'
              : 'Nothing here by that name.'
        }
        ariaLabel={run.kind === 'slash' ? 'Insert a block' : 'Mention something'}
        listboxId={run.kind === 'slash' ? 'editor-slash-menu' : 'editor-mention-menu'}
      />
    );

  return {
    extensions,
    attach: (editor) => {
      editorRef.current = editor;
    },
    menu,
    isOpen: run !== null,
  };
}
