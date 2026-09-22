/**
 * `@docket/api` — the render model the semantic read tools send their cards.
 *
 * @remarks
 * A read DTO carries its authored fields as stored Markdown, and the model reads them that way. The
 * card needs them as structure, so this reads each authored field once into a {@link RichText} and
 * sends the result in `_meta`, keyed by item id and field path. A batch card shows one line per
 * item, so a batch carries only each field's excerpt.
 *
 * Pure on purpose: the widget evidence suite builds its fixtures' `_meta` with these functions and
 * has no API environment to import anything else with.
 */
import { RENDER_META_KEY, richTextOf, type RichText, type RichTextBudget } from './rich-text';

/** What one read call returns: the items it could show and the refs it could not. */
export interface EntityReadResult {
  readonly items: readonly Readonly<Record<string, unknown>>[];
  readonly missing: readonly { readonly ref: string; readonly reason: string }[];
}

/** Every rendered field of one item, by field path. */
export type ItemRender = Readonly<Record<string, RichText>>;

/** The render model a read result carries. */
export interface EntityRender {
  readonly items: Readonly<Record<string, ItemRender>>;
  /** A single project's browsable work, keyed by project id. */
  readonly work?: Readonly<Record<string, unknown>>;
}

/** One authored field a card may draw, and how much of it a single-item card carries. */
interface RenderedField {
  readonly path: string;
  readonly budget: RichTextBudget;
}

/** Whole documents: a brief, a task description, an update or a comment. */
const DOCUMENT: RichTextBudget = { maxBlocks: 80, maxChars: 8000 };

/** A card section that previews writing which lives on its own page. */
const PREVIEW: RichTextBudget = { maxBlocks: 12, maxChars: 2000 };

/** A batch row shows one line, so it carries the excerpt and no blocks. */
const EXCERPT_ONLY: RichTextBudget = { maxBlocks: 0, maxChars: 0 };

const RENDERED_FIELDS: readonly RenderedField[] = [
  { path: 'description', budget: DOCUMENT },
  { path: 'body', budget: DOCUMENT },
  { path: 'guidance', budget: PREVIEW },
  { path: 'latestUpdate.body', budget: PREVIEW },
];

/** The string at a dotted path, or `null` when any step is missing or not a string. */
function stringAt(item: Readonly<Record<string, unknown>>, path: string): string | null {
  let value: unknown = item;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' ? value : null;
}

/** Render every authored field one item has. */
function itemRenderOf(item: Readonly<Record<string, unknown>>, batch: boolean): ItemRender {
  const fields: Record<string, RichText> = {};
  for (const field of RENDERED_FIELDS) {
    const rich = richTextOf(stringAt(item, field.path), batch ? EXCERPT_ONLY : field.budget);
    if (rich) fields[field.path] = rich;
  }
  return fields;
}

/**
 * Build the render model for a read result's items.
 *
 * @param items - The hydrated items, each with a string `id`.
 * @returns Rendered fields per item id; items with no authored fields are left out.
 */
export function entityRenderOf(items: EntityReadResult['items']): EntityRender {
  const batch = items.length > 1;
  const rendered: Record<string, ItemRender> = {};
  for (const item of items) {
    const id = item['id'];
    if (typeof id !== 'string') continue;
    const fields = itemRenderOf(item, batch);
    if (Object.keys(fields).length > 0) rendered[id] = fields;
  }
  return { items: rendered };
}

/**
 * The result `_meta` for a semantic read, or `undefined` when there is nothing to render.
 *
 * @param items - The hydrated items.
 * @param work - A single project's browsable work, keyed by project id, when the read has one.
 * @returns `_meta` carrying the render model under {@link RENDER_META_KEY}.
 */
export function entityRenderMeta(
  items: EntityReadResult['items'],
  work?: Readonly<Record<string, unknown>>,
): Record<string, EntityRender> | undefined {
  const render = entityRenderOf(items);
  if (Object.keys(render.items).length === 0 && !work) return undefined;
  return { [RENDER_META_KEY]: work ? { ...render, work } : render };
}
