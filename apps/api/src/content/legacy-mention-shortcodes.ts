/**
 * Rewrite the shortcode form an earlier mention implementation stored.
 *
 * @remarks
 * Between 2026-08-02 and this change, a mention was persisted as a self-closing shortcode:
 *
 * ```
 * [mention kind="project" id="01J…" label="Launch Docket"]
 * ```
 *
 * That form cannot express a reference to anything outside Docket — it has a kind and an id and
 * no URL — and any renderer we do not control shows the literal brackets. The current form is an
 * ordinary Markdown link carrying the same machine reference in the link-title slot, which
 * degrades to a working link everywhere and can point at a Drive file just as easily as a task.
 *
 * The rewrite is pure and idempotent: prose containing no shortcode comes back unchanged, and
 * re-running over already-rewritten prose is a no-op, so a backfill that dies halfway can simply
 * be run again.
 */
import { formatMentionLink, type MentionEntityKind } from '@docket/types';

import { entityMentionHref } from './mention-href';

/**
 * The shortcode as it was written.
 *
 * @remarks
 * Attributes were emitted in a fixed order by the only writer that ever produced them, but the
 * pattern reads them by name so a hand-edited document still converts. Quotes are the only
 * delimiter that writer used, and a label containing a quote was escaped by it, so the value
 * pattern stops at the first unescaped quote.
 */
const SHORTCODE = /\[mention\s+((?:[a-z]+="(?:[^"\\]|\\.)*"\s*)+)\]/gu;

/** One `name="value"` pair inside a shortcode. */
const ATTRIBUTE = /([a-z]+)="((?:[^"\\]|\\.)*)"/gu;

/** The object kinds the old shortcode could name. */
const LEGACY_KINDS = new Set<string>([
  'task',
  'project',
  'initiative',
  'program',
  'cycle',
  'person',
]);

/** Map an old shortcode kind onto the reference vocabulary in use now. */
function entityKindFor(kind: string): MentionEntityKind | undefined {
  if (!LEGACY_KINDS.has(kind)) return undefined;
  // `person` was the old name for what every other surface calls an actor.
  return (kind === 'person' ? 'actor' : kind) as MentionEntityKind;
}

/** Read a shortcode's attributes into a plain record. */
function attributesOf(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) found[name] = value.replace(/\\(.)/gu, '$1');
  }
  return found;
}

/**
 * Convert every shortcode mention in one body of prose into the link form.
 *
 * @param prose - The stored Markdown.
 * @param organizationId - The workspace the prose belongs to, which the href is scoped to.
 * @returns The rewritten Markdown, or the input unchanged when it holds no shortcode.
 *
 * @example
 * ```typescript
 * rewriteLegacyMentions('See [mention kind="task" id="t1" label="Ship it"]', 'org_1');
 * // 'See [Ship it](/orgs/org_1/tasks/t1 "docket:v1:task:t1")'
 * ```
 */
export function rewriteLegacyMentions(prose: string, organizationId: string): string {
  if (!prose.includes('[mention ')) return prose;

  return prose.replace(SHORTCODE, (whole, attributes: string) => {
    const { kind, id, label } = attributesOf(attributes);
    if (kind === undefined || id === undefined) return whole;

    const entityKind = entityKindFor(kind);
    if (entityKind === undefined) return whole;

    const ref = { kind: 'entity', entityKind, entityId: id } as const;
    const href = entityMentionHref(organizationId, ref);

    // A shortcode with no label still names something; the id is a poor label but it is honest,
    // and hydration replaces it with the live title the moment the document is rendered.
    return formatMentionLink(label ?? id, href, ref);
  });
}
