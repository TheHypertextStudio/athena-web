/** One compact Emojibase record used by the entity glyph picker. */
export interface EntityEmojiOption {
  readonly group?: number;
  readonly hexcode: string;
  readonly label: string;
  readonly order?: number;
  readonly tags?: readonly string[];
  readonly unicode: string;
  readonly skins?: readonly EntityEmojiOption[];
}

/** One localized CLDR group or skin-tone label. */
export interface EmojiMessage {
  readonly key: string;
  readonly label: string;
  readonly order?: number;
}

/** The English compact emoji catalog and its group labels. */
export interface EntityEmojiCatalog {
  readonly emoji: readonly EntityEmojiOption[];
  readonly groups: readonly EmojiMessage[];
  readonly skinTones: readonly EmojiMessage[];
  readonly shortcodes: Readonly<Record<string, string | readonly string[]>>;
}

/** Load the Unicode 17 English data only when the picker needs emoji. */
export async function loadEntityEmojiCatalog(): Promise<EntityEmojiCatalog> {
  const [compactModule, messagesModule, shortcodesModule] = await Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/messages.json'),
    import('emojibase-data/en/shortcodes/cldr.json'),
  ]);
  const messages = messagesModule.default;
  return {
    emoji: compactModule.default.filter((option) => option.group !== undefined),
    groups: messages.groups.map(({ key, message, order }) => ({ key, label: message, order })),
    skinTones: messages.skinTones.map(({ key, message }) => ({
      key,
      label: message,
    })),
    shortcodes: shortcodesModule.default,
  };
}
