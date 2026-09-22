/**
 * Text-level rules every reader of stored Markdown shares: how the editor's entities decode, and
 * which link targets a reader may point at.
 */

/** The entities stored Markdown and the figure codec write, and the characters they stand for. */
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * Decode the entities the editor and the figure codec write into stored Markdown.
 *
 * @remarks
 * `@tiptap/markdown` encodes `&`, `<` and `>` in every non-code text run it serializes and decodes
 * them when it reads a text token back; the figure codec also writes `&quot;` and `&#39;`. `marked`'s
 * lexer decodes nothing — a text token's `text` is the source verbatim — so any reader that walks
 * tokens directly shows `&amp;` where the author typed `&`. One pass over the source, so `&amp;lt;`
 * stays the literal text `&lt;` the author typed. Entities nobody here writes are left alone.
 *
 * Apply it to `text` tokens only. Code spans and code blocks are written unencoded.
 *
 * @param text - A text token's `text`, or a codec-escaped attribute value.
 * @returns The text the author sees in the editor.
 */
export function decodeEditorEntities(text: string): string {
  return text.replaceAll(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * Whether an inline HTML token is a line break.
 *
 * @remarks
 * A reader that drops raw HTML still has to keep a `<br>` as the break it is, or the words either
 * side of it run together.
 *
 * @param raw - The token's source.
 * @returns `true` for `<br>`, `<br/>`, and `<br />`.
 */
export function isLineBreakHtml(raw: string): boolean {
  return /^<br\s*\/?>$/i.test(raw.trim());
}

/**
 * The link target a reader may point at, or `undefined` for one it must render as plain text.
 *
 * @remarks
 * Web links and app paths only. A protocol-relative `//host` starts with a slash but leaves the
 * app, so it is refused the way `isSafeImageSource` refuses it.
 *
 * @param href - The link's authored target.
 * @returns The trimmed target when it is allowed.
 */
export function safeLinkHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed.startsWith('/')) return trimmed.startsWith('//') ? undefined : trimmed;
  return /^https?:\/\/[^/\s]/i.test(trimmed) ? trimmed : undefined;
}
