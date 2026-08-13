'use client';

/**
 * `activity` — one entry of a narrated day.
 *
 * @remarks
 * Rendered as an `EntityListRow` with `interactive={false}`, and that is a requirement rather than a
 * compromise: the row contains a text field, a pressed-state toggle and a link, and nesting those
 * inside the row's default single `<button>`/`<a>` is invalid markup that destroys keyboard
 * semantics. Turning interactivity off keeps every slot, the hover tone and the density, and lets the
 * three controls each be reachable in their own right.
 *
 * The keep toggle is deliberately *not* revealed on hover. It carries state and it is the panel's
 * primary act — hiding it would make the one thing a person came here to do undiscoverable, and
 * unreachable by touch entirely.
 */
import type { HighlightOut } from '@docket/types';
import { cn } from '@docket/ui';
import { EntityListRow, RowMeta } from '@docket/ui/components';
import { Button, Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { entityGlyph } from '@/components/activity/entity-glyph';
import { EditableTitle } from '@/components/editor/editable-title';
import { ProviderBadge } from '@/components/stream/provider-badge';

import { entryTimeLabel } from './highlight-view';

/** What a person may do to one entry. Absent means the entry is a record to read, not to curate. */
export interface DayHighlightActions {
  /** Keep or drop this entry. */
  readonly onKeepChange: (kept: boolean) => void;
  /** Replace the sentence, or pass `null` to go back to the generated one. */
  readonly onNarrationChange: (text: string | null) => void;
  /** Whether a save for this row is in flight. */
  readonly busy: boolean;
}

/** Props for {@link DayHighlightRow}. */
export interface DayHighlightRowProps {
  readonly highlight: HighlightOut;
  /** The zone the day's times are read in. */
  readonly timezone: string;
  readonly actions?: DayHighlightActions;
}

/** The sentence to show, and whether it can be edited yet. */
function narrationState(highlight: HighlightOut): {
  readonly text: string;
  readonly editable: boolean;
  readonly pending: boolean;
} {
  const { state, text } = highlight.narration;
  if (state === 'ready' && text !== null) return { text, editable: true, pending: false };
  if (state === 'failed') {
    // Never blank, and never an invented first-person sentence: say plainly that the description is
    // missing and let it be written by hand.
    return { text: '', editable: true, pending: false };
  }
  return { text: '', editable: false, pending: true };
}

/**
 * One entry: what it was about, when, where it came from, and what it says.
 *
 * @param props - The entry, the day's zone, and the curation actions when it is editable.
 * @returns the row.
 */
export function DayHighlightRow({
  highlight,
  timezone,
  actions,
}: DayHighlightRowProps): JSX.Element {
  const Glyph = entityGlyph(highlight.entityKind);
  const subject = highlight.subjectTitle ?? 'Something happened';
  const { text, editable, pending } = narrationState(highlight);
  const href = highlight.events.find((event) => event.permalink !== null)?.permalink ?? null;
  const dropped = !highlight.kept;

  return (
    <EntityListRow
      interactive={false}
      wrap
      // Dropped stays in the list, receded rather than removed: taking it away would make the toggle
      // impossible to undo and would jump the layout out from under the pointer.
      className={cn('min-h-11', dropped && 'opacity-60')}
      aria-label={subject}
      leading={<Glyph className="text-on-surface-variant size-5" aria-hidden="true" />}
      title={
        href ? (
          <a href={href} className="hover:text-primary block truncate">
            {subject}
          </a>
        ) : (
          subject
        )
      }
      subtitle={
        pending ? (
          <Text token="body-small" tone="muted">
            Writing a description…
          </Text>
        ) : (
          <EditableTitle
            value={text}
            canEdit={editable && actions !== undefined}
            onSave={(next) => {
              actions?.onNarrationChange(next);
            }}
            ariaLabel={`What happened with ${subject}`}
            placeholder="Say what happened"
            className="text-body-small text-on-surface-variant"
          />
        )
      }
      meta={
        <>
          <RowMeta>
            <ProviderBadge system={highlight.system} />
          </RowMeta>
          <RowMeta>
            <time
              dateTime={highlight.occurredAt}
              className="text-label-small tabular-nums"
              title={new Date(highlight.occurredAt).toLocaleString('en-US', { timeZone: timezone })}
            >
              {entryTimeLabel({
                occurredAt: highlight.occurredAt,
                endedAt: highlight.endedAt,
                timezone,
              })}
            </time>
          </RowMeta>
        </>
      }
      trailing={
        actions ? (
          <Button
            variant={highlight.kept ? 'secondary' : 'ghost'}
            controlSize="xs"
            aria-pressed={highlight.kept}
            disabled={actions.busy}
            onClick={() => {
              actions.onKeepChange(!highlight.kept);
            }}
          >
            {highlight.kept ? 'Kept' : 'Dropped'}
          </Button>
        ) : null
      }
    />
  );
}
