'use client';

/**
 * `components/editor/task-list-shortcut` — typing `- [ ] ` makes a checkbox.
 *
 * @remarks
 * `[ ] ` on its own line already creates a task item: that is TaskItem's own input rule, and its
 * regex is `[ ] ` with no list marker in front of it.
 *
 * Typing the Markdown spelling `- [ ] ` takes a different path. The `- ` matches BulletList's rule
 * the moment the space lands, so by the time `[` is typed the cursor is inside
 * `bulletList > listItem > paragraph` and the dash is gone from the text. TaskItem's rule then
 * matches the paragraph's `[ ] `, and `findWrapping` declines, because a `listItem` holds no
 * `taskItem`. The brackets stay as literal text.
 *
 * This rule handles that position: inside a bullet item, `[ ] ` and `[x] ` convert the list to a
 * task list and set the item's checked state. Bodies are stored as Markdown, where the spelling is
 * `- [ ] `, so this is the sequence a person typing Markdown produces.
 *
 * @see {@link ./freeform-text} for the editor that registers it.
 */
import { Extension, InputRule } from '@tiptap/core';

/** `[ ] ` or `[x] ` at the start of a textblock, matching TaskItem's own spelling. */
const TASK_MARKER = /^\s*\[([ xX])?\]\s$/;

/** The node a plain bullet list is built from. */
const BULLET_LIST_NODE = 'bulletList';

/** The node the marker converts to. */
const TASK_ITEM_NODE = 'taskItem';

/**
 * Whether a position sits inside a plain bullet list.
 *
 * @param resolved - The resolved position whose ancestors to inspect.
 * @returns `true` when a `bulletList` encloses the position.
 */
function inBulletList(resolved: {
  depth: number;
  node: (depth: number) => { type: { name: string } };
}): boolean {
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === BULLET_LIST_NODE) return true;
  }
  return false;
}

/**
 * Build the extension carrying the `- [ ] ` shortcut.
 *
 * @returns A Tiptap extension adding one input rule.
 *
 * @example
 * ```ts
 * createTaskListShortcutExtension()
 * ```
 */
export function createTaskListShortcutExtension(): Extension {
  return Extension.create({
    name: 'taskListShortcut',
    // Above the default so this rule is consulted before TaskItem's, which matches the same text
    // and would decline in this position.
    priority: 200,

    addInputRules() {
      return [
        new InputRule({
          find: TASK_MARKER,
          handler: ({ state, range, match, chain }) => {
            // Outside a bullet list, TaskItem's own rule already handles the marker.
            if (!inBulletList(state.doc.resolve(range.from))) return null;

            const checked = (match[1] ?? '').toLowerCase() === 'x';
            chain()
              .deleteRange(range)
              .toggleTaskList()
              .updateAttributes(TASK_ITEM_NODE, { checked })
              .run();
            return undefined;
          },
        }),
      ];
    },
  });
}
