/**
 * Resolve references into the cards a chip's hovercard renders.
 *
 * @remarks
 * Batched per surface rather than per chip: a description with six mentions must cost one request,
 * not six. The cap is enforced by the DTO.
 *
 * Two properties matter more than anything else here.
 *
 * Visibility is re-checked at read time even though the reconciler already refused cross-tenant
 * references at write time. The two gates protect against different things: the write gate stops a
 * forged reference from ever creating an edge, and this one stops a legitimately-written reference
 * from continuing to reveal a title after the reader's grant is revoked.
 *
 * An inaccessible entity returns `accessible: false` and *nothing else*. Not a blanked title, not
 * a placeholder — no field at all, because a card that renders "Restricted task" still confirms
 * that the id names something real.
 */
import type { MentionCard, MentionRef } from '@docket/types';
import { canonicalizeResourceUrl, mentionRefKey } from '@docket/types';

import { loadVisibleDocuments, type SearchCaller } from '../search/query';

import { entityMentionHref, type EntityMentionRef as EntityRef } from './mention-href';
import { createDrizzleMentionStorage } from './drizzle-mention-storage';
import type { ExternalResourceRepository, StoredResource } from './mention-ports';
import { toExternalResourceOut } from './resource-view';

/** A card for an entity the caller may not see: the id, and nothing that describes it. */
function inaccessibleCard(ref: EntityRef): MentionCard {
  return {
    kind: 'entity',
    entityKind: ref.entityKind,
    entityId: ref.entityId,
    accessible: false,
    title: null,
    subtitle: null,
    excerptMarkdown: null,
    href: null,
    state: null,
    health: null,
    ownerLabel: null,
    dueAt: null,
    updatedAt: null,
  };
}

/**
 * Longest raw Markdown excerpt handed to the client for rendering.
 *
 * @remarks
 * Generous rather than syntactically safe on purpose: `ExcerptMarkdown` (the client renderer this
 * feeds) tolerates a cut that lands mid-token — `marked`'s lexer degrades a truncated `**bold` or
 * `[link](h` into ordinary text rather than throwing — so there is no need to find a "safe" cut
 * point the way {@link markdownToPlainText} does for the fully-flattened `summary` field. The one
 * syntax {@link excerptMarkdownOf} does still guard against is an unterminated fenced code block —
 * see its own remarks.
 */
const EXCERPT_MARKDOWN_LENGTH = 320;

/**
 * Grapheme-cluster-aware, so a cut can never land inside one — unlike a raw UTF-16 slice (which can
 * split a surrogate pair, e.g. an emoji, into an unpaired half) or even a code-point slice (which
 * still splits a multi-code-point cluster, e.g. a ZWJ emoji sequence or a base character plus its
 * combining marks).
 */
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Cut `text` back to at most `maxLength` grapheme clusters, never splitting one apart. */
function truncateAtGrapheme(text: string, maxLength: number): { text: string; truncated: boolean } {
  const clusters = Array.from(GRAPHEME_SEGMENTER.segment(text), (segment) => segment.segment);
  if (clusters.length <= maxLength) return { text, truncated: false };
  return { text: clusters.slice(0, maxLength).join(''), truncated: true };
}

/** Cut `text` back to the last space/newline before the cut, so a truncation doesn't land mid-word. */
function trimToWordBoundary(text: string): string {
  const lastBreak = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n'));
  return lastBreak > text.length * 0.6 ? text.slice(0, lastBreak) : text;
}

/**
 * Cut off a dangling, unterminated fenced-code-block opener rather than leaving one in the excerpt.
 *
 * @remarks
 * A truncated ` ``` ` with no matching close doesn't stay inert: `marked`'s lexer reads everything
 * from that opener to the end of the string as one giant `code` token, and the client's
 * `ExcerptMarkdown` renderer drops `code` tokens outright — so an unlucky cut can make the whole
 * excerpt render blank. Trimming back to just before the dangling fence keeps whatever prose came
 * before it instead of losing the excerpt entirely.
 *
 * Only counts a ` ``` ` that opens a line (optionally indented up to three spaces, per CommonMark's
 * own fence rule) as a fence marker — a codespan may also use ` ``` ` as its own delimiter when its
 * content contains double backticks, but that always sits inline, never as the first thing on a
 * line, so this doesn't mistake one for a dangling fence.
 */
const FENCE_LINE_START = /^ {0,3}```/gm;

function closeUnterminatedFence(text: string): string {
  const fenceLines = [...text.matchAll(FENCE_LINE_START)];
  if (fenceLines.length % 2 === 0) return text;
  const last = fenceLines[fenceLines.length - 1];
  if (last === undefined) return text;
  return text.slice(0, last.index).trimEnd();
}

/**
 * Cut a raw Markdown field down to a preview length, keeping the Markdown syntax — and, crucially,
 * the newlines — intact.
 *
 * @remarks
 * `snippetOf` (`@docket/mail`) is the wrong tool here: it collapses all whitespace to single
 * spaces, and in Markdown a blank line is *significant* — it's what separates `# Heading` from the
 * paragraph that follows it. Collapsing it merges the two into one line, which `marked` then reads
 * as a single (very long) heading swallowing the paragraph, destroying exactly the block structure
 * this excerpt exists to preserve.
 *
 * The cut still breaks on a word boundary and ends with `…` when truncated, matching every other
 * truncated preview in the product — a silent mid-word cut reads as broken, not "reduced fidelity."
 * It also cuts on a grapheme-cluster boundary (see {@link truncateAtGrapheme}) so a character
 * sitting right at the cutoff is never split, and it closes off any fence the cut left dangling
 * (see {@link closeUnterminatedFence}). If those safety trims leave nothing behind, this returns
 * `null` rather than a bare `…` — the caller already falls back to the entity's flattened
 * `subtitle` when `excerptMarkdown` is null.
 */
export function excerptMarkdownOf(body: string | null): string | null {
  if (body === null) return null;
  const trimmed = body.trim();
  if (trimmed === '') return null;
  const { text, truncated } = truncateAtGrapheme(trimmed, EXCERPT_MARKDOWN_LENGTH);
  if (!truncated) return text;
  const cut = closeUnterminatedFence(trimToWordBoundary(text));
  return cut === '' ? null : `${cut}…`;
}

/** A reference to something outside Docket, narrowed from the union. */
type ExternalRef = Extract<MentionRef, { kind: 'external' }>;

/** The index fields a visible entity contributes to its card. */
interface VisibleEntitySummary {
  readonly title: string;
  readonly summary: string | null;
  /** The full, untruncated Markdown body — `search_document.body`, never flattened. */
  readonly body: string | null;
  readonly updatedAt: Date | null;
}

/** Load the visible index rows for a batch of entity refs, keyed by entity id. */
async function loadVisibleEntities(
  caller: SearchCaller,
  orgId: string,
  refs: readonly EntityRef[],
): Promise<Map<string, VisibleEntitySummary>> {
  if (refs.length === 0) return new Map();
  const rows = await loadVisibleDocuments({
    caller,
    orgId,
    entityIds: refs.map((ref) => ref.entityId),
  });
  return new Map(
    rows.map((row) => [
      row.entityId,
      { title: row.title, summary: row.summary, body: row.body, updatedAt: row.sourceUpdatedAt },
    ]),
  );
}

/** Load the shared resource rows behind a batch of external refs, keyed by the URL as written. */
async function loadResources(
  resources: ExternalResourceRepository,
  orgId: string,
  refs: readonly ExternalRef[],
): Promise<Map<string, StoredResource>> {
  if (refs.length === 0) return new Map();

  // Two authors can write the same document as two different URLs, so the lookup goes through the
  // canonical key and the result is mapped back to whichever URL each reference used.
  const byKey = new Map<string, string>();
  for (const ref of refs) {
    const canonical = canonicalizeResourceUrl(ref.url);
    if (canonical !== undefined) byKey.set(canonical.canonicalKey, ref.url);
  }
  if (byKey.size === 0) return new Map();

  const rows = await resources.findByKeys(orgId, [...byKey.keys()]);
  const out = new Map<string, StoredResource>();
  for (const row of rows) {
    const url = byKey.get(row.canonicalKey);
    if (url !== undefined) out.set(url, row);
  }
  return out;
}

/** One surface's worth of references to resolve. */
export interface MentionHydrateRequest {
  /** Where resource rows are read from. Injected, so hydration is testable with no database. */
  readonly resources?: ExternalResourceRepository;
  /** Whose access decides what each card may say. */
  readonly caller: SearchCaller;
  /** The workspace the references were authored in. */
  readonly orgId: string;
  /** The references, already deduped by the caller. */
  readonly refs: readonly MentionRef[];
}

/**
 * Resolve a batch of references into preview cards.
 *
 * @param input - The caller, the org, and the refs a rendered surface needs cards for.
 * @returns One card per resolvable ref, in request order. Refs we cannot resolve are omitted.
 */
export async function hydrateMentions(input: MentionHydrateRequest): Promise<MentionCard[]> {
  const entityRefs = input.refs.filter((ref): ref is EntityRef => ref.kind === 'entity');
  const externalRefs = input.refs.filter((ref): ref is ExternalRef => ref.kind === 'external');

  const [entities, resources] = await Promise.all([
    loadVisibleEntities(input.caller, input.orgId, entityRefs),
    loadResources(
      input.resources ?? createDrizzleMentionStorage().resources,
      input.orgId,
      externalRefs,
    ),
  ]);

  const seen = new Set<string>();
  const cards: MentionCard[] = [];
  for (const ref of input.refs) {
    const key = mentionRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);

    if (ref.kind === 'entity') {
      const found = entities.get(ref.entityId);
      if (found === undefined) {
        cards.push(inaccessibleCard(ref));
        continue;
      }
      cards.push({
        kind: 'entity',
        entityKind: ref.entityKind,
        entityId: ref.entityId,
        accessible: true,
        title: found.title,
        subtitle: found.summary,
        excerptMarkdown: excerptMarkdownOf(found.body),
        href: entityMentionHref(input.orgId, ref),
        state: null,
        health: null,
        ownerLabel: null,
        dueAt: null,
        updatedAt: found.updatedAt?.toISOString() ?? null,
      });
      continue;
    }

    const row = resources.get(ref.url);
    if (row === undefined) continue;
    cards.push({ kind: 'external', url: ref.url, resource: toExternalResourceOut(row) });
  }
  return cards;
}
