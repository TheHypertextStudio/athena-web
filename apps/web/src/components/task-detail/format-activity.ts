/**
 * Sentence construction for a task's activity log.
 *
 * @remarks
 * Every string a log entry renders is written here, in the application's own voice. Nothing in an
 * entry is ever provider prose or an exception message: the API hands over a stable machine
 * `field` key, an application-owned `label`, and display-ready `from`/`to` values, and this module
 * assembles them into one readable sentence.
 *
 * The four shapes mirror how a person actually narrates an edit: something was created, a value
 * was set for the first time, a value was cleared, or a value moved from one thing to another.
 * Distinguishing "set" from "changed" matters — "changed Assignee from  to Grace" reads as a bug,
 * and an unset value must never surface as a literal "null" or a bare dash.
 */
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import type { ActorKind } from '@docket/ui/components';

import { formatProvenance } from '@/lib/provenance/format';

/**
 * Build the one-sentence description of what an activity entry records.
 *
 * @param entry - The activity entry to describe.
 * @returns the sentence, without the actor's name (which the row renders alongside it).
 *
 * @example
 * ```ts
 * activitySentence(entry); // 'changed Status from Todo to In progress'
 * ```
 */
export function activitySentence(entry: TaskActivityOut): string {
  const change = entry.change;
  if (entry.type === 'created' || change === null) return 'created this task';
  if (change.to === null) return `cleared ${change.label}`;
  if (change.from === null) return `set ${change.label} to ${change.to}`;
  return `changed ${change.label} from ${change.from} to ${change.to}`;
}

/**
 * Name the actor behind an entry.
 *
 * @remarks
 * A change with no attributable actor is a real, ordinary case — an automation run, a scheduled
 * roll-over, an integration sync. "Someone" is honest about that without inventing an identity or
 * leaking an internal service name into the reader's history.
 *
 * @param entry - The activity entry.
 * @returns the actor's display name, or the application-owned fallback.
 */
export function activityActorName(entry: TaskActivityOut): string {
  return entry.actorName ?? 'Someone';
}

/** Who a row names, the avatar it draws, and how the change arrived. */
export interface ActivityPerformer {
  readonly name: string;
  readonly avatarKind: ActorKind;
  /** The channel detail for the timestamp's tooltip, or null for a person working in the app. */
  readonly detail: string | null;
}

/**
 * Name the performer behind an entry.
 *
 * @remarks
 * A change Athena, an agent, or Docket itself performed names that performer, so an MCP edit
 * reads "Claude Code set Status to Done". A change a person made reads exactly as it always has.
 *
 * @param entry - The activity entry.
 * @param currentActorId - The viewer's actor, so an agent working for them reads "for You".
 * @returns the performer to show.
 */
export function activityPerformer(
  entry: TaskActivityOut,
  currentActorId: string | null,
): ActivityPerformer {
  const origin = entry.origin;
  const display =
    origin === null || origin.performerKind === 'person'
      ? null
      : formatProvenance(origin, { actorId: entry.actorId, name: entry.actorName }, currentActorId);
  if (display === null) {
    return { name: activityActorName(entry), avatarKind: 'human', detail: null };
  }
  return { name: display.performer, avatarKind: display.avatarKind, detail: display.detail };
}

/**
 * The timestamp's tooltip: the exact time, with the channel detail beside it.
 *
 * @param createdAt - When the entry was recorded (ISO-8601).
 * @param detail - The performer's channel detail, when there is one.
 * @returns the tooltip text.
 */
export function activityTimestampTitle(createdAt: string, detail: string | null): string {
  if (detail === null) return createdAt;
  const parsed = new Date(createdAt);
  const exact = Number.isNaN(parsed.getTime())
    ? createdAt
    : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `${exact} · ${detail}`;
}
