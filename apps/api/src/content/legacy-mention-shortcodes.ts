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
import { formatMentionLink } from '@docket/types';

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

/** The entity kinds a legacy shortcode can name, once mapped onto the current vocabulary. */
export type LegacyMentionEntityKind =
  | 'task'
  | 'project'
  | 'initiative'
  | 'program'
  | 'cycle'
  | 'actor';

/** Map an old shortcode kind onto the reference vocabulary in use now. */
function entityKindFor(kind: string): LegacyMentionEntityKind | undefined {
  if (!LEGACY_KINDS.has(kind)) return undefined;
  // `person` was the old name for what every other surface calls an actor.
  return (kind === 'person' ? 'actor' : kind) as LegacyMentionEntityKind;
}

/**
 * The label a shortcode with no captured `label` falls back to when the entity it names can no
 * longer be looked up (deleted, or the sweep's lookup pass missed it) — by entity kind.
 *
 * @remarks
 * A mention chip renders the persisted label as-is until its hydration fetch resolves (see
 * `MentionNodeView`), so a raw id here isn't just a migration artifact, it's what a viewer sees
 * for a moment on every load. {@link rewriteLegacyMentions}'s `resolveName` looks up the entity's
 * real, current name first — this is the last resort for when that lookup comes up empty, and a
 * kind name stays honest about "no name was found" without leaking an opaque id.
 */
const FALLBACK_LABEL: Record<LegacyMentionEntityKind, string> = {
  task: 'Task',
  project: 'Project',
  initiative: 'Initiative',
  program: 'Program',
  cycle: 'Cycle',
  actor: 'Person',
};

/** Read a shortcode's attributes into a plain record. */
function attributesOf(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) found[name] = value.replace(/\\(.)/gu, '$1');
  }
  return found;
}

/** One shortcode reference with no captured `label`, found ahead of a rewrite pass. */
export interface UnlabeledMentionRef {
  readonly entityKind: LegacyMentionEntityKind;
  readonly entityId: string;
}

/**
 * Find every shortcode in one body of prose that names something but captured no `label`.
 *
 * @remarks
 * The sweep calls this first, across a whole batch of rows, so it can look up every referenced
 * entity's real current name in one batched query per kind before rewriting a single row — a
 * lookup {@link rewriteLegacyMentions} itself has no database access to perform.
 *
 * @param prose - The stored Markdown to scan.
 * @returns The unlabeled references found, in no particular order (a shortcode repeated in the
 *   same prose yields one entry per occurrence).
 */
export function findUnlabeledMentionRefs(prose: string): readonly UnlabeledMentionRef[] {
  if (!prose.includes('[mention ')) return [];

  const refs: UnlabeledMentionRef[] = [];
  for (const match of prose.matchAll(SHORTCODE)) {
    const attributes = match[1];
    if (attributes === undefined) continue;
    const { kind, id, label } = attributesOf(attributes);
    if (kind === undefined || id === undefined || label !== undefined) continue;
    const entityKind = entityKindFor(kind);
    if (entityKind === undefined) continue;
    refs.push({ entityKind, entityId: id });
  }
  return refs;
}

/**
 * Convert every shortcode mention in one body of prose into the link form.
 *
 * @param prose - The stored Markdown.
 * @param organizationId - The workspace the prose belongs to, which the href is scoped to.
 * @param resolveName - Looks up an entity's real current name for a shortcode with no captured
 *   `label`, typically backed by the batched lookup the sweep ran via
 *   {@link findUnlabeledMentionRefs}. Omit it (or return `undefined`) to fall back straight to
 *   {@link FALLBACK_LABEL} — e.g. for callers with no database access, such as tests.
 * @returns The rewritten Markdown, or the input unchanged when it holds no shortcode.
 *
 * @example
 * ```typescript
 * rewriteLegacyMentions('See [mention kind="task" id="t1" label="Ship it"]', 'org_1');
 * // 'See [Ship it](/orgs/org_1/tasks/t1 "docket:v1:task:t1")'
 * ```
 */
export function rewriteLegacyMentions(
  prose: string,
  organizationId: string,
  resolveName?: (ref: UnlabeledMentionRef) => string | undefined,
): string {
  if (!prose.includes('[mention ')) return prose;

  return prose.replace(SHORTCODE, (whole, attributes: string) => {
    const { kind, id, label } = attributesOf(attributes);
    if (kind === undefined || id === undefined) return whole;

    const entityKind = entityKindFor(kind);
    if (entityKind === undefined) return whole;

    const ref = { kind: 'entity', entityKind, entityId: id } as const;
    const href = entityMentionHref(organizationId, ref);

    const resolvedName = label ?? resolveName?.({ entityKind, entityId: id });
    return formatMentionLink(resolvedName ?? FALLBACK_LABEL[entityKind], href, ref);
  });
}
