/**
 * The trigger-character machinery behind `@` mentions and `/` block insertion.
 *
 * @remarks
 * A ProseMirror plugin rather than a dependency. Tiptap's own `@tiptap/suggestion` package is
 * not installed in this workspace, and the behaviour needed here is small and specific: watch
 * the text immediately before the caret, and while it looks like `<trigger><query>` report the
 * query, the document range it occupies, and where to draw a menu. Everything else — what the
 * options are, how they render, what choosing one does — belongs to the caller.
 *
 * Three rules make it feel right rather than merely work:
 *
 * 1. **A trigger only fires at a word boundary.** `you@example.com` is an email address, not a
 *    mention, so the character before the trigger must be the start of a text block or
 *    whitespace. Nothing pops open while someone types an address or a file path.
 * 2. **A run ends before it becomes prose.** Titles have spaces in them, so a mention query may
 *    span a few words — but a run abandons itself past `maxWords`, or on a double space, so
 *    typing an `@` mid-sentence and carrying on writing does not leave a menu hanging open for
 *    the rest of the paragraph. A `/` command takes no spaces at all.
 * 3. **Escape leaves the typed text alone and stays dismissed.** The literal `@` or `/` stays
 *    exactly where it was typed, and continuing to type does not resurrect the menu for that
 *    same trigger. A menu that reappears after you dismissed it is worse than no menu.
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** A live suggestion run: the caret sits just after `<trigger><query>`. */
export interface SuggestionRun {
  /** The character that opened the run (`@` or `/`). */
  readonly trigger: string;
  /** Everything typed after the trigger, excluding the trigger itself. */
  readonly query: string;
  /** Document range covering the trigger and the query, for replacement. */
  readonly from: number;
  /** Exclusive end of {@link SuggestionRun.from}. */
  readonly to: number;
  /** Viewport rectangle of the trigger character, for anchoring a floating menu. */
  readonly rect: DOMRect;
}

/** What the plugin reports to its host: an active run, or `null` when nothing is open. */
export type SuggestionListener = (run: SuggestionRun | null) => void;

/** Keys the host menu may claim while a run is open. Return `true` to consume the key. */
export type SuggestionKeyHandler = (event: KeyboardEvent) => boolean;

/** Configuration for {@link createSuggestionPlugin}. */
export interface SuggestionPluginOptions {
  /** Unique plugin key name — one plugin per trigger character. */
  readonly pluginName: string;
  /** The character that opens a run. */
  readonly trigger: string;
  /** Only fire when the trigger sits at the very start of a text block. */
  readonly startOfBlockOnly?: boolean;
  /** Longest query the run will track before giving up (a runaway `/` is not a command). */
  readonly maxQueryLength?: number;
  /** How many space-separated words the query may span. `1` forbids spaces entirely. */
  readonly maxWords?: number;
  /** Receives the active run, or `null`. */
  readonly onChange: SuggestionListener;
  /** Consulted first for every keydown while a run is open. */
  readonly onKeyDown: SuggestionKeyHandler;
}

/** Internal per-plugin state: the position of a trigger the person dismissed. */
interface PluginState {
  /** Document position of a dismissed trigger, remapped through every edit. */
  readonly dismissedAt: number | null;
}

/** What {@link createSuggestionPlugin} hands back. */
export interface SuggestionPluginHandle {
  /** The plugin to register with the editor. */
  readonly plugin: Plugin<PluginState>;
  /** Suppress the run starting at `from` until a new run begins elsewhere. */
  readonly dismiss: (view: EditorView, from: number) => void;
}

/**
 * The trigger character's rectangle, in viewport coordinates.
 *
 * @remarks
 * `coordsAtPos` measures through `Range.getClientRects`, which throws outright in environments
 * that do not implement layout (jsdom) and can also throw in a real browser for a position whose
 * DOM has just been replaced. A menu that cannot be *placed* should still be *offered*, so a
 * failure degrades to the document origin rather than tearing down the run.
 *
 * @param view - The editor view.
 * @param pos - The document position of the trigger character.
 * @returns A viewport rectangle for the caret.
 */
function caretRect(view: EditorView, pos: number): DOMRect {
  try {
    const coords = view.coordsAtPos(pos);
    return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
  } catch {
    return new DOMRect(0, 0, 0, 0);
  }
}

/** Characters that may precede a trigger for it to count as starting a word. */
const BOUNDARY = /[\s([{]/;

/** Placeholder standing in for an inline atom, so text offsets stay aligned with positions. */
const LEAF_PLACEHOLDER = '￼';

/**
 * Read the suggestion run ending at the caret, if any.
 *
 * @param state - The editor state to inspect.
 * @param trigger - The trigger character.
 * @param startOfBlockOnly - Require the trigger to be the block's first character.
 * @param maxQueryLength - Abandon the run past this many query characters.
 * @returns The run's text and range, or `null`.
 */
function readRun(
  state: EditorState,
  trigger: string,
  startOfBlockOnly: boolean,
  maxQueryLength: number,
  maxWords: number,
): { trigger: string; query: string; from: number; to: number } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if ($from.parent.type.spec.code) return null;

  const blockStart = $from.start();
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF_PLACEHOLDER);
  const triggerIndex = textBefore.lastIndexOf(trigger);
  if (triggerIndex === -1) return null;

  const query = textBefore.slice(triggerIndex + trigger.length);
  if (query.length > maxQueryLength) return null;
  if (query.startsWith(' ') || query.includes('  ')) return null;
  if (query.split(' ').length > maxWords) return null;
  if (/[\n\t]/.test(query)) return null;

  if (startOfBlockOnly) {
    if (triggerIndex !== 0) return null;
  } else {
    const preceding = triggerIndex === 0 ? '' : textBefore.charAt(triggerIndex - 1);
    if (preceding !== '' && !BOUNDARY.test(preceding)) return null;
  }

  return {
    trigger,
    query,
    from: blockStart + triggerIndex,
    to: blockStart + $from.parentOffset,
  };
}

/**
 * Build a suggestion plugin for one trigger character.
 *
 * @param options - The {@link SuggestionPluginOptions}.
 * @returns The plugin plus its dismissal command, which shares the plugin's private key.
 */
export function createSuggestionPlugin(options: SuggestionPluginOptions): SuggestionPluginHandle {
  const {
    pluginName,
    trigger,
    startOfBlockOnly = false,
    maxQueryLength = 60,
    maxWords = 1,
    onChange,
    onKeyDown,
  } = options;
  const key = new PluginKey<PluginState>(pluginName);

  /** Signature of the run last reported, so identical states are not re-announced. */
  let announced: string | null = null;

  const plugin = new Plugin<PluginState>({
    key,
    state: {
      init: (): PluginState => ({ dismissedAt: null }),
      apply: (transaction, value): PluginState => {
        const meta = transaction.getMeta(key) as { dismissedAt: number | null } | undefined;
        if (meta) return { dismissedAt: meta.dismissedAt };
        if (value.dismissedAt === null) return value;
        return { dismissedAt: transaction.mapping.map(value.dismissedAt) };
      },
    },
    props: {
      handleKeyDown: (_view, event) => (announced === null ? false : onKeyDown(event)),
    },
    view: (view: EditorView) => {
      const publish = (): void => {
        const run = readRun(view.state, trigger, startOfBlockOnly, maxQueryLength, maxWords);
        const dismissed = key.getState(view.state)?.dismissedAt ?? null;
        if (!run || dismissed === run.from) {
          if (announced !== null) {
            announced = null;
            onChange(null);
          }
          return;
        }
        const signature = `${String(run.from)}:${run.query}`;
        if (signature === announced) return;
        announced = signature;
        onChange({ ...run, rect: caretRect(view, run.from) });
      };
      publish();
      return {
        update: publish,
        destroy: () => {
          if (announced !== null) {
            announced = null;
            onChange(null);
          }
        },
      };
    },
  });

  return {
    plugin,
    dismiss: (view, from) => {
      view.dispatch(view.state.tr.setMeta(key, { dismissedAt: from }));
    },
  };
}
