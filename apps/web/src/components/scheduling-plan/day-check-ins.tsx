'use client';

/**
 * The day's check-ins, and their answers.
 *
 * @remarks
 * The rows exist ahead of time, which is what lets this surface distinguish "not yet due", "due
 * and waiting on you", "answered", and "came and went unanswered". The last of those is the one
 * that matters: a check-in nobody answered is a fact about the day, and hiding it would make the
 * record of the day flattering rather than true.
 */
import type {
  CheckInResponse,
  DayCheckInOut,
} from '@docket/planning/scheduling-directive-contract';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ControlGroup,
  Stack,
  Text,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Application-owned label for each answer. */
const RESPONSE_LABEL: Readonly<Record<CheckInResponse, string>> = {
  on_track: 'On track',
  behind: 'Behind',
  switched: 'Switched',
  done: 'Done',
};

/** The order the answer buttons are offered in. */
const RESPONSES: readonly CheckInResponse[] = ['on_track', 'behind', 'switched', 'done'];

/** Local clock reading. */
function clock(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}

/** Props for {@link DayCheckIns}. */
export interface DayCheckInsProps {
  readonly checkIns: readonly DayCheckInOut[];
  readonly timezone: string;
  readonly onRespond: (input: { id: string; response: CheckInResponse }) => void;
  readonly busy?: boolean;
}

/**
 * The check-in list.
 *
 * @param props - The day's check-ins and the answer action.
 * @returns the list.
 */
export function DayCheckIns(props: DayCheckInsProps): JSX.Element {
  const upcoming = props.checkIns.filter(
    (item) => item.firedAt === null && item.respondedAt === null && !item.missed,
  );
  const current = props.checkIns.filter((item) => !upcoming.includes(item));
  const answered = props.checkIns.filter((c) => c.respondedAt !== null).length;
  return (
    <Stack gap={4} className="w-full min-w-0">
      <Stack gap={1}>
        <Text as="h2" token="title-medium">
          Check-ins
        </Text>
        <Text token="body-small" tone="muted">
          {`${String(props.checkIns.length)} today · ${String(answered)} answered`}
        </Text>
      </Stack>
      <Stack gap={2} as="ul" data-testid="check-in-list">
        {current.map((checkIn) => (
          <CheckInRow key={checkIn.id} {...props} checkIn={checkIn} />
        ))}
      </Stack>
      {upcoming.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              Upcoming check-ins ({upcoming.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Stack gap={2} as="ul" className="pt-3">
              {upcoming.map((checkIn) => (
                <CheckInRow key={checkIn.id} {...props} checkIn={checkIn} />
              ))}
            </Stack>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </Stack>
  );
}

/** One answered, due, missed, or upcoming check-in, retaining its original response semantics. */
function CheckInRow(props: DayCheckInsProps & { readonly checkIn: DayCheckInOut }): JSX.Element {
  const { checkIn } = props;
  return (
    <li
      key={checkIn.id}
      className="bg-surface-container-low flex min-w-0 flex-col gap-2 rounded-xl px-4 py-3"
      data-testid="check-in"
      data-state={checkIn.respondedAt !== null ? 'answered' : checkIn.missed ? 'missed' : 'waiting'}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Text token="label-small" tone="muted" numeric className="shrink-0 whitespace-nowrap">
          {clock(checkIn.scheduledAt, props.timezone)}
        </Text>
        <Text token="body-medium" className="min-w-0 break-words">
          {checkIn.prompt}
        </Text>
      </div>
      {checkIn.respondedAt === null && checkIn.firedAt !== null ? (
        <ControlGroup controlSize="sm" wrap>
          {RESPONSES.map((response) => (
            <Button
              key={response}
              variant="secondary"
              disabled={props.busy === true || checkIn.firedAt === null}
              onClick={() => {
                props.onRespond({ id: checkIn.id, response });
              }}
            >
              {RESPONSE_LABEL[response]}
            </Button>
          ))}
        </ControlGroup>
      ) : checkIn.respondedAt !== null ? (
        <Text token="body-small" tone="muted">
          {`You said: ${RESPONSE_LABEL[checkIn.response ?? 'on_track']}`}
        </Text>
      ) : (
        <Text token="body-small" tone="muted">
          Later today
        </Text>
      )}
      {checkIn.respondedAt === null && checkIn.missed ? (
        <Text token="body-small" tone="muted">
          This one came and went unanswered.
        </Text>
      ) : null}
    </li>
  );
}
