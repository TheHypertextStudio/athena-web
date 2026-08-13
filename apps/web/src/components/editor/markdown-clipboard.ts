'use client';

/**
 * `components/editor/markdown-clipboard` — the editor's half of copy and paste.
 *
 * @remarks
 * Docket's bodies are Markdown all the way down: stored as Markdown in a `text` column, loaded with
 * `contentType: 'markdown'`, saved with `editor.getMarkdown()`. This extension carries that through
 * the clipboard in both directions.
 *
 * - **Copy** fills the plain flavor with Markdown, serialized through the same `MarkdownManager`
 *   that persists the document. ProseMirror owns `text/html`, which it emits from each node's
 *   `renderHTML`.
 * - **Paste** accepts Markdown arriving as plain text, which is what most editors, chat apps and
 *   issue trackers put on the clipboard.
 *
 * Both directions route through that one manager, and mentions declare their own
 * `renderMarkdown`/`parseMarkdown` ({@link ../mentions/mention-extension}), so a Docket → anywhere →
 * Docket round trip keeps its `docket:v1:` reference markers and comes home as live chips.
 *
 * ## What paste claims
 *
 * The handler declines far more often than it acts, because a wrong paste destroys content the user
 * cannot always recover. It interprets plain text only when all of these hold:
 *
 * - The cursor sits outside a code block. A fence is where Markdown syntax is data.
 * - The clipboard carries no `text/html`. ProseMirror's parser handles that flavor against the real
 *   schema.
 * - The text carries an unambiguous Markdown construct ({@link looksLikeMarkdown}), so ordinary
 *   prose pastes as ordinary prose.
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
   * A resolver, because an extension's options are captured when the editor is *created* and
   * `useEditor` keeps that instance for its lifetime. Asking at paste time keeps the answer current
   * for a surface that mounted before its workspace resolved.
   *
   * Injected so this extension stays free of the API client and stays unit testable. Surfaces with
   * no workspace context return `null` here and fall through to the default paste.
   */
  readonly resolveUploader: () => PastedImageUploader | null;
}

/**
 * Whether plain text is worth parsing as Markdown.
 *
 * @remarks
 * Every pattern here requires a positive signal of syntax: a hash followed by a space at the start
 * of a line, a bullet with content after it, a fence, a bracketed link, a pipe table. Prose produces
 * none of them by accident, which is what keeps a pasted paragraph intact.
 *
 * Exported for its own test: this predicate decides whether a paste is interpreted at all.
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
 * keystroke, so a copy and a save agree — including for the custom nodes (mentions, code blocks)
 * that declare their own `renderMarkdown`. The Markdown extension is registered before this one.
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
 * Selecting a few words inside one paragraph yields a fragment of *inline* nodes, which the top node
 * type accepts only once wrapped in a paragraph, so that wrapping happens here. Anything the manager
 * cannot serialize falls back to ProseMirror's own text extraction, so a copy always produces
 * something.
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
    // Block serializers pad their output with newlines to separate blocks within a document. Those
    // edges paste as stray blank lines, so they come off here.
    return markdownManager(editor)
      .serialize(document.toJSON() as JSONContent)
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
  } catch {
    return plainText();
  }
}

/** Whether the cursor sits inside a code block, where Markdown syntax is content. */
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
 * The "nothing else" is load-bearing. A screenshot, or a browser's "Copy image", puts bytes on the
 * clipboard and no text, and that is the case worth rehosting. Copying a rich document that
 * *contains* an image carries the document's text too, and takes the HTML path so every word around
 * the picture survives.
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
 * The position is captured before the upload starts, so a person who pastes a screenshot and carries
 * on typing elsewhere still gets the picture where they put it, however long the network takes.
 *
 * The editor may be gone by the time the bytes land — the reader navigated away — so a destroyed
 * editor ends the insert.
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

              // A fence is where Markdown syntax is content, so it stays literal.
              if (inCodeBlock(view.state)) return false;

              const image = imageOnlyFile(clipboardData);
              const uploadImage = image === null ? null : resolveUploader();
              if (image !== null && uploadImage !== null) {
                if (editor.schema.nodes[IMAGE_NODE] === undefined) return false;
                event.preventDefault();
                // The paste position, held for the length of the upload.
                const at = view.state.selection.from;
                // The upload reports its own failure through the surface that owns it, so a rejected
                // insert is absorbed here.
                void insertUploadedImage(editor, uploadImage, image, at).catch(() => undefined);
                return true;
              }

              // ProseMirror parses the HTML flavor against the real schema.
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
