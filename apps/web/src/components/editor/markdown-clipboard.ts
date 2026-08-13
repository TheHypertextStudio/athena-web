'use client';

/**
 * `components/editor/markdown-clipboard` — the editor's half of copy and paste.
 *
 * @remarks
 * Bodies are stored as Markdown, loaded with `contentType: 'markdown'`, and saved with
 * `editor.getMarkdown()`. This extension carries that through the clipboard.
 *
 * - **Copy** fills `text/plain` with Markdown from the same `MarkdownManager` that persists the
 *   document. ProseMirror owns `text/html`.
 * - **Paste** interprets Markdown arriving as plain text.
 *
 * Mentions declare `renderMarkdown`/`parseMarkdown` ({@link ../mentions/mention-extension}), so a
 * Docket → anywhere → Docket round trip keeps its `docket:v1:` markers and comes home as live chips.
 *
 * Paste interprets plain text only when all three hold:
 *
 * - The cursor sits outside a code block.
 * - The clipboard carries no `text/html`.
 * - The text carries a Markdown construct ({@link looksLikeMarkdown}).
 *
 * @see {@link ../../lib/clipboard/write} for the non-editor clipboard path.
 */
import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Fragment, type Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** The node name of the custom code block. */
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
   * A resolver: extension options are captured when the editor is created, and `useEditor` keeps
   * that instance for its lifetime. Asking at paste time reaches a workspace that resolved after
   * the editor mounted.
   *
   * Injected, keeping this extension free of the API client. A `null` return declines the paste.
   */
  readonly resolveUploader: () => PastedImageUploader | null;
}

/**
 * Whether plain text is worth parsing as Markdown.
 *
 * @remarks
 * Each pattern requires an explicit construct: a hash followed by a space at line start, a bullet
 * with content after it, a fence, a bracketed link, a pipe table.
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
 * The same instance that parses the stored Markdown and serializes it back on every keystroke, so a
 * copy and a save produce identical output for custom nodes such as mentions and code blocks. The
 * Markdown extension is registered before this one.
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
 * Selecting a few words inside one paragraph yields a fragment of *inline* nodes. The top node type
 * accepts those only inside a paragraph, so they are wrapped here. A serialization failure falls
 * back to ProseMirror's text extraction.
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
    // Block serializers pad their output with newlines. Those edges paste as stray blank lines.
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
 * A screenshot, or a browser's "Copy image", puts bytes on the clipboard and no text. A rich
 * document containing an image carries its text too, and takes the HTML path with its prose intact.
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
 * The position is captured before the upload starts, so the image lands where it was pasted however
 * long the network takes and wherever the cursor moves to meanwhile.
 *
 * A destroyed editor ends the insert; the reader may navigate away mid-upload.
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

              // Inside a fence, Markdown syntax is content.
              if (inCodeBlock(view.state)) return false;

              const image = imageOnlyFile(clipboardData);
              const uploadImage = image === null ? null : resolveUploader();
              if (image !== null && uploadImage !== null) {
                if (editor.schema.nodes[IMAGE_NODE] === undefined) return false;
                event.preventDefault();
                // The paste position, held for the length of the upload.
                const at = view.state.selection.from;
                // The upload reports its own failure through the surface that owns it.
                void insertUploadedImage(editor, uploadImage, image, at).catch(() => undefined);
                return true;
              }

              // ProseMirror parses the HTML flavor against the schema.
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
