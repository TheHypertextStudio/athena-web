/**
 * `today/today-attention` — what actually needs this person today, in parts rather than one number.
 *
 * @remarks
 * This replaces a single sentence — "140 items need your attention today." — that was not merely
 * unactionable but wrong about its own subject. The server computes
 * `attentionCount = approvals + blocked + dueToday + inbox`
 * (`apps/api/src/routes/hub-today.ts`), so an account with a hundred unread notifications reads as
 * a hundred things due today. The count that looks like a workload is mostly a mailbox.
 *
 * So the strip does two things the sentence could not:
 *
 * 1. **It separates the parts**, because three approvals and eight tasks due are different kinds of
 *    obligation and summing them destroys both. A zero part renders nothing — an all-clear day is
 *    quiet rather than a row of zeroes.
 * 2. **It puts the mailbox on the other side of the row.** Unread notifications are the one item
 *    here that is not already rendered further down this page, which is also the reason it is the
 *    one item that links away.
 *
 * `brief.text` survives for the genuinely-clear case. Those strings ("Your next two moves are
 * ready.") are good, application-owned server copy; only the counting sentence is replaced.
 */
import type { HubNeedsAttention } from '@docket/types';
import { ArrowRight } from '@docket/ui/icons';
import { Row } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

/** Props for {@link TodayAttention}. */
export interface TodayAttentionProps {
  /** The cross-workspace attention trio plus the unread mailbox count. */
  readonly needsAttention: HubNeedsAttention | undefined;
  /** The server's reading of the day, used when nothing is actually outstanding. */
  readonly brief: { readonly text: string; readonly attentionCount: number } | undefined;
}

/** One `{n} {noun}` part of the strip, or nothing when the count is zero. */
function part(count: number, singular: string, plural: string): string | null {
  if (count <= 0) return null;
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * Cap a mailbox count for display.
 *
 * @remarks
 * Matches the nav's own treatment, so the same number does not read as `128` here and `99+` in the
 * sidebar three inches to the left.
 */
function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** The day's outstanding work, split into its parts, with the mailbox held separate. */
export function TodayAttention({ needsAttention, brief }: TodayAttentionProps): JSX.Element | null {
  if (!needsAttention && !brief) return null;

  const approvals = needsAttention?.approvals.length ?? 0;
  const blocked = needsAttention?.blocked.length ?? 0;
  const dueToday = needsAttention?.dueToday.length ?? 0;
  const inbox = needsAttention?.inbox ?? 0;

  const parts = [
    part(approvals, 'approval', 'approvals'),
    part(blocked, 'blocked', 'blocked'),
    part(dueToday, 'due today', 'due today'),
  ].filter((entry): entry is string => entry !== null);

  // Only the server's non-counting copy is trustworthy here; its counting sentence is the thing
  // this component exists to replace, so an outstanding mailbox alone gets application-owned copy.
  const restingText = brief?.attentionCount === 0 ? brief.text : 'Nothing is waiting on you today.';

  return (
    <Row gap={2} className="text-on-surface-variant text-body-small -mt-6 min-h-6 flex-wrap">
      {parts.length > 0 ? (
        parts.map((entry, index) => (
          <Row key={entry} gap={2}>
            {index > 0 ? (
              <span aria-hidden="true" className="text-outline">
                ·
              </span>
            ) : null}
            <span className="text-on-surface tabular-nums">{entry}</span>
          </Row>
        ))
      ) : (
        <span>{restingText}</span>
      )}
      {inbox > 0 ? (
        <Link
          href="/inbox"
          className="hover:text-primary focus-visible:ring-ring ml-auto flex items-center gap-1 tabular-nums underline-offset-4 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
        >
          {unreadLabel(inbox)} unread
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      ) : null}
    </Row>
  );
}

export default TodayAttention;
