import type { EntityDisplayGlyph } from '@docket/work/entity-display-contract';
import type { EntityEmojiCatalog, EntityEmojiOption } from '@docket/ui/icons/emoji-catalog';
import { ENTITY_SYMBOL_OPTIONS } from '@docket/ui/icons/entity-symbol-catalog';

/** One normalized choice presented by the combined glyph picker. */
export interface EntityGlyphOption {
  readonly id: string;
  readonly catalog: 'symbol' | 'emoji';
  readonly glyph: EntityDisplayGlyph;
  readonly label: string;
  readonly shortcodes: readonly string[];
  readonly keywords: readonly string[];
  readonly order: number;
  readonly unicode?: string;
}

const CURATED_SYMBOL_NAMES = [
  'track_changes',
  'folder_open',
  'account_tree',
  'layers',
  'flag',
  'groups',
  'calendar_month',
  'target',
  'route',
  'map',
  'rocket_launch',
  'timeline',
  'task_alt',
  'checklist',
  'event',
  'public',
  'hub',
  'handshake',
  'lightbulb',
  'campaign',
  'school',
  'menu_book',
  'directions_bus',
  'train',
  'subway',
  'apartment',
  'diversity_3',
  'auto_awesome',
] as const;

const CATALOG_SYMBOL_GLYPH_OPTIONS: readonly EntityGlyphOption[] = ENTITY_SYMBOL_OPTIONS.map(
  (option) => ({
    id: `symbol:${option.name}`,
    catalog: 'symbol',
    glyph: { kind: 'symbol', name: option.name },
    label: option.label,
    shortcodes: [],
    keywords: option.keywords,
    order: option.order,
  }),
);

const CURATED_SYMBOL_RANK = new Map<string, number>(
  CURATED_SYMBOL_NAMES.map((name, index) => [name, index]),
);

/** Every Material Symbol option, with useful work symbols before the complete pinned catalog. */
export const SYMBOL_GLYPH_OPTIONS: readonly EntityGlyphOption[] = [
  ...CATALOG_SYMBOL_GLYPH_OPTIONS,
].sort((left, right) => {
  const leftName = left.glyph.kind === 'symbol' ? left.glyph.name : '';
  const rightName = right.glyph.kind === 'symbol' ? right.glyph.name : '';
  const leftRank = CURATED_SYMBOL_RANK.get(leftName) ?? Number.POSITIVE_INFINITY;
  const rightRank = CURATED_SYMBOL_RANK.get(rightName) ?? Number.POSITIVE_INFINITY;
  return leftRank - rightRank || left.order - right.order;
});

/** Build emoji choices using the viewer's selected skin tone where a variant exists. */
export function emojiGlyphOptions(
  catalog: EntityEmojiCatalog,
  skinTone: string | null,
): readonly EntityGlyphOption[] {
  return catalog.emoji.map((base, index) => {
    const selected = skinTone
      ? (base.skins?.find((skin) => hasOnlySkinTone(skin.hexcode, skinTone)) ?? base)
      : base;
    const shortcode = catalog.shortcodes[base.hexcode];
    const shortcodes = Array.isArray(shortcode) ? shortcode : shortcode ? [shortcode] : [];
    return emojiOption(selected, base, shortcodes, index);
  });
}

function hasOnlySkinTone(hexcode: string, skinTone: string): boolean {
  const modifiers = hexcode.split('-').filter((part) => /^1F3F[B-F]$/.test(part));
  return modifiers.length > 0 && modifiers.every((modifier) => modifier === skinTone);
}

function emojiOption(
  selected: EntityEmojiOption,
  base: EntityEmojiOption,
  shortcodes: readonly string[],
  index: number,
): EntityGlyphOption {
  return {
    id: `emoji:${selected.hexcode}`,
    catalog: 'emoji',
    glyph: { kind: 'emoji', hexcode: selected.hexcode },
    label: selected.label,
    shortcodes,
    keywords: base.tags ?? [],
    order: base.order ?? index,
    unicode: selected.unicode,
  };
}

/** Rank options by exact, prefix, token, alias, and substring matches. */
export function searchGlyphOptions(
  options: readonly EntityGlyphOption[],
  search: string,
): readonly EntityGlyphOption[] {
  const query = normalize(search);
  if (!query) return options;
  return options
    .map((option) => ({ option, score: matchScore(option, query) }))
    .filter((candidate) => candidate.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score || left.option.order - right.option.order)
    .map((candidate) => candidate.option);
}

/** Suggest at most twelve stable choices from the meaningful tokens in an entity name. */
export function suggestGlyphOptions(
  options: readonly EntityGlyphOption[],
  entityName: string,
): readonly EntityGlyphOption[] {
  const tokens = normalize(entityName)
    .split(' ')
    .filter((token) => token.length >= 3);
  const rankedByToken = tokens.map((token) => suggestionMatches(options, token));
  const offsets = rankedByToken.map(() => 0);
  const seen = new Set<string>();
  const suggestions: EntityGlyphOption[] = [];
  while (suggestions.length < 12) {
    let added = false;
    for (const [tokenIndex, matches] of rankedByToken.entries()) {
      let option = matches[offsets[tokenIndex] ?? 0];
      while (option && seen.has(option.id)) {
        offsets[tokenIndex] = (offsets[tokenIndex] ?? 0) + 1;
        option = matches[offsets[tokenIndex] ?? 0];
      }
      if (!option) continue;
      offsets[tokenIndex] = (offsets[tokenIndex] ?? 0) + 1;
      seen.add(option.id);
      suggestions.push(option);
      added = true;
      if (suggestions.length === 12) return suggestions;
    }
    if (!added) break;
  }
  return suggestions;
}

function suggestionMatches(
  options: readonly EntityGlyphOption[],
  token: string,
): readonly EntityGlyphOption[] {
  const aliasMatches = options.filter((option) =>
    option.keywords.some((keyword) => normalize(keyword) === token),
  );
  const strongMatches = searchGlyphOptions(options, token).filter(
    (option) => matchScore(option, token) <= 3,
  );
  return [...aliasMatches, ...strongMatches].filter(
    (option, index, matches) => matches.findIndex((match) => match.id === option.id) === index,
  );
}

function matchScore(option: EntityGlyphOption, query: string): number {
  const label = normalize(option.label);
  const name =
    option.glyph.kind === 'symbol'
      ? normalize(option.glyph.name)
      : option.glyph.hexcode.toLowerCase();
  const primary = [label, name];
  const shortcodes = option.shortcodes.map(normalize);
  const aliases = option.keywords.map(normalize);
  if (primary.includes(query) || shortcodes.includes(query)) return 0;
  if ([...primary, ...shortcodes].some((value) => value.startsWith(query))) return 1;
  const queryTokens = query.split(' ');
  if (queryTokens.every((token) => label.split(' ').some((word) => word.startsWith(token))))
    return 2;
  if (aliases.some((value) => value === query || value.startsWith(query))) return 3;
  if ([...primary, ...shortcodes, ...aliases].some((value) => value.includes(query))) return 4;
  return Number.POSITIVE_INFINITY;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll('_', ' ').replaceAll(':', '');
}
