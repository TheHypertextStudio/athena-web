/**
 * `@docket/api` — curating what a day says.
 *
 * @remarks
 * The write half of the narrated day, and deliberately the *only* one. It can change three things:
 * whether a line is kept, what its sentence says, and when a person last touched it. It cannot touch
 * the `event` log, and there is nowhere in its reach to do so — that separation is what "the record is
 * fixed, the story is editable" means in practice rather than as a slogan.
 *
 * Dropping keeps the row and clears a flag, so the decision is reversible and the day's evidence
 * survives a change of mind. Reverting a rewrite clears `edited_narration` rather than overwriting
 * `narration`, so the generated sentence is still there to come back to.
 */
import { activityDay, activityHighlight, db } from '@docket/db';
import type { HighlightOut, HighlightPatch } from '@docket/types';
import type { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';

import { NotFoundError } from '../../error';
import { toStreamEventOut } from '../../routes/stream-helpers';

/** The columns a curated highlight is projected from. */
type HighlightRow = typeof activityHighlight.$inferSelect;

/** Project one persisted highlight onto the wire shape. */
async function toHighlightOut(row: HighlightRow): Promise<z.input<typeof HighlightOut>> {
  const { event } = await import('@docket/db');
  const events =
    row.eventIds.length === 0
      ? []
      : await db.select().from(event).where(inArray(event.id, row.eventIds));
  const byId = new Map(events.map((found) => [found.id, found]));
  return {
    id: row.id,
    episodeKey: row.episodeKey,
    sort: row.sort,
    occurredAt: row.occurredAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    system: row.sourceSystem,
    entityKind: row.entityKind,
    docketEntityId: row.docketEntityId,
    association: row.entityAssociation,
    subjectTitle: row.subjectTitle,
    narration: {
      state: row.narrationState,
      text: row.editedNarration ?? row.narration,
      edited: row.editedNarration !== null,
    },
    kept: row.kept,
    curatedAt: row.curatedAt?.toISOString() ?? null,
    events: row.eventIds.flatMap((id) => {
      const found = byId.get(id);
      return found ? [toStreamEventOut(found, null)] : [];
    }),
  };
}

/**
 * Change what one highlight says, or whether it is said at all.
 *
 * @remarks
 * Ownership is established by joining through to the day, and a highlight belonging to somebody else
 * is reported as missing rather than forbidden — a 403 would confirm that the id exists and that it
 * belongs to a particular day, which is more than a stranger should learn.
 *
 * @param userId - The caller.
 * @param highlightId - The highlight to change.
 * @param patch - What to change. An absent field is left alone.
 * @param now - The reference time, stamped as the curation moment.
 * @returns the highlight as it now stands.
 * @throws {NotFoundError} When the highlight is not the caller's.
 */
export async function curateHighlight(
  userId: string,
  highlightId: string,
  patch: HighlightPatch,
  now: Date,
): Promise<z.input<typeof HighlightOut>> {
  const [owned] = await db
    .select({ id: activityHighlight.id })
    .from(activityHighlight)
    .innerJoin(activityDay, eq(activityDay.id, activityHighlight.activityDayId))
    .where(and(eq(activityHighlight.id, highlightId), eq(activityDay.userId, userId)))
    .limit(1);
  if (!owned) throw new NotFoundError('Highlight not found');

  // An empty patch is a no-op read rather than an error: a client that sends one gets the current
  // state back, and nothing records a curation that did not happen.
  const touched = patch.kept !== undefined || patch.narration !== undefined;
  const [updated] = touched
    ? await db
        .update(activityHighlight)
        .set({
          ...(patch.kept === undefined ? {} : { kept: patch.kept }),
          // `null` clears the rewrite and falls back to the generated sentence, which is still there.
          ...(patch.narration === undefined ? {} : { editedNarration: patch.narration }),
          curatedAt: now,
        })
        .where(eq(activityHighlight.id, highlightId))
        .returning()
    : await db
        .select()
        .from(activityHighlight)
        .where(eq(activityHighlight.id, highlightId))
        .limit(1);

  /* v8 ignore next -- ownership was just established, so the row is there */
  if (!updated) throw new NotFoundError('Highlight not found');
  return toHighlightOut(updated);
}
