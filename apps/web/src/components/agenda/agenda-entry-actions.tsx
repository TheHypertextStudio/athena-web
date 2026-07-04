'use client';

/**
 * `agenda/agenda-entry-actions` — the per-entry edit affordance: a quiet `⋯` menu plus a popover
 * editor for the two actions that need input (set a timebox window, move to an arbitrary day).
 *
 * @remarks
 * Composed from the shared {@link DropdownMenu} (the actions) and {@link Popover} (the form): the
 * menu trigger doubles as the popover anchor, so choosing "Set timebox…" / "Move to a day…" closes
 * the menu and opens the form anchored to the same spot. Direct actions (check-off lives on the
 * card; clear-timebox, move-to-tomorrow, remove) fire straight through {@link useAgenda}'s mutation
 * operations, which optimistically update the day so the edit lands instantly.
 *
 * Only rendered for entries that are on the plan (they carry the `planItemId` every edit needs).
 */
import { Ellipsis } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Row,
  Stack,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { clockValue, toISODateTime } from '@/lib/format-time';

import { type AgendaEntry, isTimeboxed, shiftISODate, useAgenda } from './agenda-context';

/** Which popover editor is open (the actions that need input), or `null` when none is. */
type EntryEditor = 'timebox' | 'move' | null;

/** Props for {@link AgendaEntryActions}. */
export interface AgendaEntryActionsProps {
  /** The plan entry these actions edit (must carry a `planItemId`). */
  entry: AgendaEntry;
}

/** The `⋯` actions menu + popover editor for a single agenda entry. */
export default function AgendaEntryActions({ entry }: AgendaEntryActionsProps): JSX.Element {
  const { date, clearTimebox, moveToDay, removeFromPlan } = useAgenda();
  const [editor, setEditor] = useState<EntryEditor>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const timeboxed = isTimeboxed(entry);

  const openEditor = (next: Exclude<EntryEditor, null>): void => {
    setMenuOpen(false);
    window.setTimeout(() => {
      setEditor(next);
    }, 0);
  };

  return (
    <Popover
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open) setEditor(null);
      }}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Entry actions"
              className="text-on-surface-variant hover:text-on-surface mt-0.5 size-7 shrink-0"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={() => {
              openEditor('timebox');
            }}
          >
            {timeboxed ? 'Edit timebox…' : 'Set timebox…'}
          </DropdownMenuItem>
          {timeboxed ? (
            <DropdownMenuItem
              onSelect={() => {
                clearTimebox(entry);
              }}
            >
              Clear timebox
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              moveToDay(entry, shiftISODate(date, 1));
            }}
          >
            Move to tomorrow
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              openEditor('move');
            }}
          >
            Move to a day…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => {
              removeFromPlan(entry);
            }}
          >
            Remove from plan
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent align="end" className="w-64">
        {editor === 'timebox' ? (
          <TimeboxForm
            entry={entry}
            date={date}
            onDone={() => {
              setEditor(null);
            }}
          />
        ) : editor === 'move' ? (
          <MoveForm
            entry={entry}
            date={date}
            onDone={() => {
              setEditor(null);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Props shared by the popover editors. */
interface EntryEditorProps {
  /** The entry being edited. */
  entry: AgendaEntry;
  /** The day the entry belongs to (the editor's local-time anchor). */
  date: string;
  /** Close the popover (called after a successful submit or cancel). */
  onDone: () => void;
}

/** Start/end time fields that set (or re-set) the entry's timebox window for the day. */
function TimeboxForm({ entry, date, onDone }: EntryEditorProps): JSX.Element {
  const { setTimebox } = useAgenda();
  const [start, setStart] = useState(() =>
    isTimeboxed(entry) ? clockValue(entry.startsAt) : '09:00',
  );
  const [end, setEnd] = useState(() => (isTimeboxed(entry) ? clockValue(entry.endsAt) : '10:00'));
  const valid = end > start;

  return (
    <Stack
      as="form"
      gap={3}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        setTimebox(entry, toISODateTime(date, start), toISODateTime(date, end));
        onDone();
      }}
    >
      <Row gap={2} align="end">
        <Stack gap={1} className="flex-1">
          <label htmlFor="timebox-start" className="text-on-surface-variant text-xs font-medium">
            Start
          </label>
          <Input
            id="timebox-start"
            type="time"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
            }}
          />
        </Stack>
        <Stack gap={1} className="flex-1">
          <label htmlFor="timebox-end" className="text-on-surface-variant text-xs font-medium">
            End
          </label>
          <Input
            id="timebox-end"
            type="time"
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
            }}
          />
        </Stack>
      </Row>
      {valid ? null : (
        <p className="text-destructive text-xs">End time must be after the start time.</p>
      )}
      <Button type="submit" size="sm" disabled={!valid}>
        Set timebox
      </Button>
    </Stack>
  );
}

/** A day field that moves the entry to another day (re-adds it there, unscheduled). */
function MoveForm({ entry, date, onDone }: EntryEditorProps): JSX.Element {
  const { moveToDay } = useAgenda();
  const [target, setTarget] = useState(() => shiftISODate(date, 1));
  const valid = target !== '' && target !== date;

  return (
    <Stack
      as="form"
      gap={3}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        moveToDay(entry, target);
        onDone();
      }}
    >
      <Stack gap={1}>
        <label htmlFor="move-day" className="text-on-surface-variant text-xs font-medium">
          Move to
        </label>
        <Input
          id="move-day"
          type="date"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
          }}
        />
      </Stack>
      <Button type="submit" size="sm" disabled={!valid}>
        Move
      </Button>
    </Stack>
  );
}
