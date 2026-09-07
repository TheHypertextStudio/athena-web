import { Marked, type Token, type TokenizerAndRendererExtension } from 'marked';

/** The underline syntax that the Tiptap Markdown serializer writes. */
const underlineExtension: TokenizerAndRendererExtension = {
  name: 'underline',
  level: 'inline',
  start: (src) => src.indexOf('++'),
  tokenizer(src) {
    const match = /^\+\+(?=\S)([\s\S]*?\S)\+\+/.exec(src);
    if (match === null) return undefined;
    const text = match[1] ?? '';
    return { type: 'underline', raw: match[0], text, tokens: this.lexer.inlineTokens(text) };
  },
};

/** A private parser instance shared by client and server-safe persisted Markdown renderers. */
const staticMarked = new Marked().use({ extensions: [underlineExtension] });

/** Parse persisted Markdown using the exact nonstandard syntax that the editor serializes. */
export function parsePersistedMarkdown(value: string): Token[] {
  return staticMarked.lexer(value, { gfm: true, breaks: false });
}
