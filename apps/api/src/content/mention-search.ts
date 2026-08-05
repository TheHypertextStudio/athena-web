/**
 * The local wave of the `@` picker: Docket entities the caller can already see.
 *
 * @remarks
 * Answers from `search_document` alone, with no provider call and no network, because this wave
 * has one job — be on screen before the user notices they typed. The external wave is a separate
 * request precisely so a slow provider can never hold this one back.
 *
 * Permission filtering is delegated wholesale to {@link searchWorkspace} and
 * {@link loadRecentDocuments}. Nothing in this module writes its own `WHERE` over
 * `search_document`.
 */
import {
  mentionRefKey,
  type MentionEntityKind,
  type MentionItem,
  type SearchDocumentKind,
  type SearchOut,
} from '@docket/types';

import { loadRecentDocuments, searchWorkspace, type SearchCaller } from '../search/query';

/**
 * The entity kinds worth offering in a mention picker.
 *
 * @remarks
 * Narrower than the full search taxonomy, and the omissions are deliberate. `label` and
 * `saved_view` are not things anyone points at mid-sentence, `activity` is an event rather than a
 * referent, and `organization` is the container the reference already lives in. Each would cost a
 * row in the one surface where menu space is scarcest.
 */
export const MENTIONABLE_KINDS: readonly SearchDocumentKind[] = [
  'task',
  'project',
  'program',
  'initiative',
  'milestone',
  'cycle',
  'member',
  'team',
  'agent_session',
  'comment',
  'update',
];

/**
 * Map a search kind onto the mention taxonomy.
 *
 * @remarks
 * The two enums agree on almost every name; `member` is the exception, because search names the
 * membership while a mention points at the Actor. Anything unmapped is simply not mentionable, and
 * returning undefined drops it from the picker rather than inventing a kind for it.
 */
function mentionEntityKindFor(kind: SearchDocumentKind): MentionEntityKind | undefined {
  switch (kind) {
    case 'task':
    case 'project':
    case 'program':
    case 'initiative':
    case 'cycle':
    case 'milestone':
    case 'team':
    case 'comment':
    case 'update':
    case 'agent_session':
      return kind;
    case 'member':
      return 'actor';
    default:
      return undefined;
  }
}

/**
 * Project one search hit into a picker row.
 *
 * @param result - A permission-filtered search hit.
 * @returns The row, or undefined when the hit is not something a mention can point at.
 */
export function toMentionItem(result: SearchOut['items'][number]): MentionItem | undefined {
  const route = result.route;
  if (route.type !== 'entity' && route.type !== 'content') return undefined;

  const searchKind = route.type === 'entity' ? route.entityKind : route.contentKind;
  const entityId = route.type === 'entity' ? route.entityId : route.contentId;
  const entityKind = mentionEntityKindFor(searchKind);
  if (entityKind === undefined) return undefined;

  const ref = { kind: 'entity', entityKind, entityId } as const;
  return {
    origin: 'local',
    id: mentionRefKey(ref),
    ref,
    entityKind,
    title: result.title,
    // The parent's title and nothing else. The index's summary is the entity's description in
    // Markdown, which reads as source code in a one-line row and takes the space the title needs
    // to stay legible. What the row owes the reader is which of two similarly named things this
    // is; the rest belongs to the hovercard.
    subtitle: result.subject?.title ?? null,
    href: route.href,
    score: result.score,
  };
}

/** What the local picker wave needs to answer a keystroke. */
export interface LocalMentionQuery {
  /** Whose permissions the results are filtered against. */
  readonly caller: SearchCaller;
  /** The workspace to look in. */
  readonly orgId: string;
  /** What has been typed after the `@`; empty asks for recents. */
  readonly query: string;
  /** How many rows to return. */
  readonly limit: number;
}

/**
 * Run the local wave: entity search, or recents when nothing has been typed yet.
 *
 * @param input - The caller, the org, the typed query, and how many rows to return.
 * @returns Picker rows, best first, deduped by ref.
 */
export async function searchLocalMentions(input: LocalMentionQuery): Promise<MentionItem[]> {
  const query = input.query.trim();
  const results =
    query.length === 0
      ? await loadRecentDocuments({
          caller: input.caller,
          orgId: input.orgId,
          kinds: MENTIONABLE_KINDS,
          limit: input.limit,
        })
      : (
          await searchWorkspace({
            scope: 'org',
            caller: input.caller,
            orgId: input.orgId,
            activeOrgId: input.orgId,
            params: {
              q: query,
              limit: input.limit,
              surface: 'palette',
              kinds: MENTIONABLE_KINDS,
            },
          })
        ).items;

  const seen = new Set<string>();
  const items: MentionItem[] = [];
  for (const result of results) {
    const item = toMentionItem(result);
    if (item === undefined || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}
