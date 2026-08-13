'use client';

/**
 * `components/editor/markdown-clipboard` — the editor's half of copy and paste.
 *
 * @remarks
 * Docket's bodies are Markdown all the way down: stored as Markdown in a `text` column, loaded with
 * `contentType: 'markdown'`, saved with `editor.getMarkdown()`. The clipboard was the one place that
 * fact was thrown away. ProseMirror's default `text/plain` flavor is `textBetween`, which walks the
 * document collecting characters and nothing else — so `# Rollout plan` followed by `- [ ] Flip the
 * flag` left the editor as `Rollout plan Flip the flag`. Every heading, bullet, checkbox, and fence
 * was lost the moment the content landed anywhere that reads plain text.
 *
 * This extension makes the clipboard speak the document's own language in both directions:
 *
 * - **Copy** replaces the plain flavor with real Markdown, serialized through the very
 *   `MarkdownManager` that persists the document. `text/html` is left to ProseMirror, which already
 *   emits correct structure from each node's `renderHTML` — so rich targets were never the problem
 *   and are deliberately not touched.
 * - **Paste** accepts Markdown that arrives as plain text, which is what most editors, chat apps,
 *   and issue trackers put on the clipboard alongside their HTML, and what some put there alone.
 *
 * Because both directions route through the same manager, and because mentions already declare
 * `renderMarkdown`/`parseMarkdown` ({@link ../mentions/mention-extension}), a Docket → anywhere →
 * Docket round trip keeps its `docket:v1:` reference markers and comes home as live chips rather
 * than as dead link text.
 *
 * ## What paste deliberately does not claim
 *
 * The handler is written to *decline* far more often than it acts, because a paste it gets wrong
 * destroys content the user cannot always recover:
 *
 * - Inside a code block, nothing is interpreted. A fence is the one place Markdown syntax is data.
 * - When the clipboard carries `text/html`, that always wins. It is richer than the plain flavor and
 *   ProseMirror's own parser handles it against the real schema.
 * - Plain text is only parsed when it actually *looks* like Markdown ({@link looksLikeMarkdown}).
 *   Ordinary prose that happens to open with a hyphen must paste as ordinary prose.
 *
 * @see {@link ../../lib/clipboard/write} for the non-editor clipboard path.
 */
import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Fragment, type Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** The node name the custom code block keeps (`CodeBlock.extend` does not rename it). */
const CODE_BLOCK_NODE = 'codeBlock';

/** The node name the image extension registers under. */
const IMAGE_NODE = 'image';

/** Uploads one pasted image and resolves the URL it became addressable at. */
export type PastedImageUploader = (file: File) => Promise<string | null>;

/** Options for {@link createMarkdownClipboardExtension}. */
export interface MarkdownClipboardOptions {
  /**
   * Resolve the current uploader for image bytes found on the clipboard, or `null` where uploads
   * are unavailable.
   *
   * @remarks
   * A resolver rather than the uploader itself, because an extension's options are captured when the
   * editor is *created* and `useEditor` never rebuilds it. A surface that mounts before its workspace
   * resolves would otherwise hold `null` for the rest of its life and silently drop every pasted
   * screenshot. Asking at paste time is what keeps the answer current.
   *
   * Injected rather than imported so this extension stays free of the API client and remains unit
   * testable, and so surfaces with no workspace context (which have nowhere to upload *to*) fall
   * through to the default paste.
   */
  readonly resolveUploader: () => PastedImageUploader | null;
}

/**
 * Whether plain text is worth parsing as Markdown.
 *
 * @remarks
 * The bar is a *positive* signal of syntax, never an absence of one. Getting this wrong in the
 * permissive direction is what turns a pasted paragraph into mangled structure, so every pattern
 * here requires a construct that prose does not produce by accident: a hash followed by a space at
 * the start of a line, a bullet with content after it, a fence, a bracketed link, a pipe table.
 *
 * Exported for its own test, because this predicate — not the parser — is what decides whether a
 * paste is interpreted at all.
 *
 * @param text - The clipboard's plain-text flavor.
 * @returns `true` when the text carries at least one unambiguous Markdown construct.
 */
export function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6} \S/m.test(text) || // # Heading
    /^\s*[-*+] \[[ xX]\] /m.test(text) || // - [ ] task
    /^\s*[-*+] \S/m.test(text) || // - bullet
    /^\s*\d+\. \S/m.test(text) || // 1. ordered
    /^\s*> \S/m.test(text) || // > quote
    /^\s*```/m.test(text) || // fenced code
    /^\s*(?:\*\s*){3,}$|^\s*(?:-\s*){3,}$|^\s*(?:_\s*){3,}$/m.test(text) || // thematic break
    /^\s*\|.*\|\s*$/m.test(text) || // | table | row |
    /\[[^\]\n]+\]\([^)\s]+\)/.test(text) || // [text](href)
    /\*\*[^*\n]+\*\*/.test(text) || // **bold**
    /(^|\s)`[^`\n]+`/.test(text) // `code`
  );
}

/**
 * The Markdown manager the editor already persists through.
 *
 * @remarks
 * The same instance that turned the stored Markdown into this document and turns it back on every
 * keystroke. Reusing it — rather than standing up a second serializer — is what guarantees a copy
 * and a save agree, including for the custom nodes (mentions, code blocks) that declare their own
 * `renderMarkdown`. The Markdown extension must therefore be registered before this one.
 */
function markdownManager(editor: Editor): {
  serialize: (content: JSONContent) => string;
  parse: (markdown: string) => JSONContent;
} {
  return editor.storage.markdown.manager;
}

/**
 * Serialize a copied slice to Markdown.
 *
 * @remarks
 * A slice is not a document. Selecting a few words inside one paragraph yields a fragment of *inline*
 * nodes, which the top node type will not accept, so an inline fragment is wrapped in a paragraph
 * first. Anything the manager cannot serialize falls back to ProseMirror's own text extraction —
 * a copy must always produce something, even when it cannot produce Markdown.
 *
 * @param editor - The editor whose schema and manager to serialize through.
 * @param slice - The copied slice.
 * @returns The Markdown text for the plain clipboard flavor.
 */
export function serializeSliceToMarkdown(editor: Editor, slice: Slice): string {
  const plainText = (): string => slice.content.textBetween(0, slice.content.size, '\n\n');

  const first = slice.content.firstChild;
  if (first === null) return '';

  try {
    const { schema } = editor;
    const paragraph = schema.nodes['paragraph'];
    const content =
      first.isInline && paragraph !== undefined
        ? Fragment.from(paragraph.create(null, slice.content))
        : slice.content;
    const document = schema.topNodeType.create(null, content);
    // Block serializers pad their output with newlines so blocks separate correctly *within* a
    // document. A clipboard payload is not a document, and those edges paste as stray blank lines.
    return markdownManager(editor)
      .serialize(document.toJSON() as JSONContent)
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
  } catch {
    return plainText();
  }
}

/** Whether the cursor sits inside a code block, where syntax is data rather than formatting. */
function inCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === CODE_BLOCK_NODE) return true;
  }
  return false;
}

/**
 * The single image on the clipboard, when the clipboard is carrying an image and nothing else.
 *
 * @remarks
 * The "nothing else" is load-bearing. Copying a rich document that *contains* an image puts both the
 * image bytes and the document's text on the clipboard; treating that as an image paste would insert
 * the picture and silently discard every word around it. A screenshot, or a browser's "Copy image",
 * carries no text — which is exactly the case worth rehosting.
 *
 * @param clipboardData - The paste event's data.
 * @returns The image file, or `null` when this is not an image-only paste.
 */
function imageOnlyFile(clipboardData: DataTransfer): File | null {
  if (clipboardData.getData('text/plain').trim() !== '') return null;
  for (const file of Array.from(clipboardData.files)) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

/**
 * Upload a pasted image and place it where it was pasted, leaving the document untouched on failure.
 *
 * @remarks
 * The position is captured before the upload starts, not read after it finishes. An upload takes as
 * long as the network does, and a person who pastes a screenshot and then carries on typing
 * elsewhere would otherwise find the picture dropped wherever their cursor had drifted to.
 *
 * The editor may also be gone by the time the bytes land — the reader navigated away — so a
 * destroyed editor is checked for rather than dispatched into.
 *
 * @param editor - The editor to insert into.
 * @param upload - The uploader resolved at paste time.
 * @param file - The pasted image.
 * @param at - The document position the paste happened at.
 */
async function insertUploadedImage(
  editor: Editor,
  upload: PastedImageUploader,
  file: File,
  at: number,
): Promise<void> {
  const src = await upload(file);
  if (src === null || editor.isDestroyed) return;
  editor.commands.insertContentAt(at, { type: IMAGE_NODE, attrs: { src, alt: file.name } });
}

/**
 * Build the editor's clipboard extension.
 *
 * @param options - How to resolve the pasted-image uploader at paste time.
 * @returns A Tiptap extension supplying the copy serializer and the paste handler.
 *
 * @example
 * ```ts
 * createMarkdownClipboardExtension({ resolveUploader: () => uploadRef.current })
 * ```
 */
export function createMarkdownClipboardExtension(
  options: MarkdownClipboardOptions,
): Extension<MarkdownClipboardOptions> {
  return Extension.create<MarkdownClipboardOptions>({
    name: 'markdownClipboard',

    addOptions() {
      return options;
    },

    addProseMirrorPlugins() {
      const { editor } = this;
      const resolveUploader = this.options.resolveUploader;

      return [
        new Plugin({
          key: new PluginKey('markdownClipboard'),
          props: {
            clipboardTextSerializer: (slice) => serializeSliceToMarkdown(editor, slice),

            handlePaste: (view: EditorView, event: ClipboardEvent): boolean => {
              const clipboardData = event.clipboardData;
              if (clipboardData === null) return false;

              // A fence is the one place Markdown syntax is content. Never interpret it.
              if (inCodeBlock(view.state)) return false;

              const image = imageOnlyFile(clipboardData);
              const uploadImage = image === null ? null : resolveUploader();
              if (image !== null && uploadImage !== null) {
                if (editor.schema.nodes[IMAGE_NODE] === undefined) return false;
                event.preventDefault();
                // The paste position, not wherever the cursor ends up while the upload is in flight.
                const at = view.state.selection.from;
                // A rejected insert must not escape as an unhandled rejection; the upload itself
                // already reports its own failure through the surface that owns it.
                void insertUploadedImage(editor, uploadImage, image, at).catch(() => undefined);
                return true;
              }

              // HTML is richer than the plain flavor and is parsed against the real schema.
              if (clipboardData.getData('text/html') !== '') return false;

              const text = clipboardData.getData('text/plain');
              if (text === '' || !looksLikeMarkdown(text)) return false;

              try {
                const content = markdownManager(editor).parse(text);
                editor.commands.insertContent(content);
                return true;
              } catch {
                return false;
              }
            },
          },
        }),
      ];
    },
  });
}
