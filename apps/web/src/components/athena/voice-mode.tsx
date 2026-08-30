'use client';

/**
 * Athena's voice mode — a live session on the conversation you were already having.
 *
 * @remarks
 * ## Why this is a panel on the conversation, not a page
 *
 * Voice is a *mode*, not a destination. Entering it never navigates, never opens a settings tab,
 * and never starts a new thread: the panel shows the conversation as it already stood and appends
 * to it. The transcript in this panel is the same timeline the text surface renders, which is why
 * the last thing you typed is sitting there when the microphone opens.
 *
 * ## The four states, and why the meter is real
 *
 * `listening · thinking · speaking` are the states a person can name, and the panel names them
 * plainly. The listening indicator is driven by **actual microphone energy** sampled from the live
 * stream, not by an animation on a timer, because the first thing anyone does in a voice mode is
 * check that it can hear them — and an indicator that moves regardless answers nothing.
 *
 * ## In-flight actions are shown while she is still talking
 *
 * Actions appear the moment they start, with their own row, rather than after the turn. On a
 * screen-less channel the sentence is the receipt; here the row is, and it renders during speech
 * rather than after it, matching what the session engine actually does.
 */
import type {
  VoiceActionOut,
  VoiceSessionOut,
  VoiceSessionState,
  VoiceTurnOut,
} from '@docket/athena/voice';
import { Mic, MicOff, PhoneOff, Sparkles, SoundWave } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  ControlGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Surface,
  surfaceToneColor,
  Text,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import {
  requestMicrophone,
  VoiceClient,
  VoiceStartError,
  type VoiceStartRefusal,
} from './voice-client';

/** Props for {@link VoiceMode}. */
export interface VoiceModeProps {
  /** Whether the voice panel is open. */
  readonly open: boolean;
  /** Close the panel and end the session. */
  readonly onOpenChange: (open: boolean) => void;
  /** Workspace the session acts in; omitted uses the personal workspace. */
  readonly workspaceId?: string | null;
  /** Extra lines to show above the fetched conversation (used by tests and stories). */
  readonly history?: readonly VoiceTurnOut[];
}

/** What each state is called on screen, in the words a person would use. */
const STATE_LABEL: Readonly<Record<VoiceSessionState, string>> = {
  idle: 'Getting ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  ended: 'Ended',
};

/** Application-owned copy for every way starting a session can fail. */
const REFUSAL_COPY: Readonly<Record<VoiceStartRefusal, string>> = {
  'microphone-denied':
    'Docket needs your microphone to talk. Allow it in your browser’s site settings, then try again.',
  'microphone-missing':
    'No microphone is available. Plug one in or pick one in your sound settings.',
  'audio-unsupported': 'This browser can’t run voice mode. Try Chrome, Edge, or Safari.',
  'link-failed': 'The voice connection didn’t open. Try again in a moment.',
};

/**
 * The live voice session panel.
 *
 * @param props - Open state, workspace focus, and the conversation so far.
 */
export function VoiceMode({
  open,
  onOpenChange,
  workspaceId,
  history = [],
}: VoiceModeProps): JSX.Element {
  const [session, setSession] = useState<VoiceSessionOut | null>(null);
  const [state, setState] = useState<VoiceSessionState>('idle');
  const [level, setLevel] = useState(0);
  const [turns, setTurns] = useState<readonly VoiceTurnOut[]>([]);
  const [actions, setActions] = useState<readonly VoiceActionOut[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // The conversation as it already stood. Entering voice must not look like a blank slate — the
  // last thing you typed is the whole reason this is the *same* conversation.
  const priorQ = useApiQuery(
    apiQueryOptions(
      queryKeys.voiceTranscript(),
      () => api.v1.me.athena.voice.transcript.$get(),
      'Could not load the conversation.',
      { enabled: open },
    ),
  );
  const clientRef = useRef<VoiceClient | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const start = useApiMutation<VoiceSessionOut, { workspaceId: string | null }>({
    mutationFn: (json) =>
      unwrap(() => api.v1.me.athena.voice.$post({ json }), 'Voice mode isn’t available right now.'),
  });

  const teardown = useCallback((): void => {
    clientRef.current?.stop();
    clientRef.current = null;
  }, []);

  /** Open the microphone, mint the session, and go live. */
  const begin = useCallback(async (): Promise<void> => {
    setNotice(null);
    setTurns([]);
    setActions([]);
    let stream: MediaStream;
    try {
      stream = await requestMicrophone();
    } catch (caught) {
      setNotice(
        caught instanceof VoiceStartError
          ? REFUSAL_COPY[caught.refusal]
          : REFUSAL_COPY['audio-unsupported'],
      );
      return;
    }

    let opened: VoiceSessionOut;
    try {
      opened = await start.mutateAsync({ workspaceId: workspaceId ?? null });
    } catch (caught) {
      for (const track of stream.getTracks()) track.stop();
      setNotice(userErrorMessage(caught, 'Voice mode isn’t available right now.'));
      return;
    }
    setSession(opened);

    const credential = opened.credential;
    if (!credential) {
      for (const track of stream.getTracks()) track.stop();
      setNotice(REFUSAL_COPY['link-failed']);
      return;
    }

    const client = new VoiceClient(
      stream,
      credential,
      {
        send: (events) =>
          unwrap(
            () =>
              api.v1.me.athena.voice[':id'].events.$post({
                param: { id: opened.id },
                json: { events: [...events] },
              }),
            'Lost the voice connection.',
          ),
      },
      {
        onState: setState,
        onTurns: (incoming) => {
          setTurns((current) => [...current, ...incoming]);
        },
        onLevel: setLevel,
        onNotice: setNotice,
      },
    );
    clientRef.current = client;
    try {
      await client.start();
      setState('listening');
    } catch (caught) {
      client.stop();
      clientRef.current = null;
      setNotice(
        caught instanceof VoiceStartError
          ? REFUSAL_COPY[caught.refusal]
          : REFUSAL_COPY['link-failed'],
      );
    }
  }, [start, workspaceId]);

  // Start when the panel opens; release the microphone whenever it closes, including on unmount.
  // The browser's recording indicator staying lit after a person closed the panel is the single
  // most alarming way this feature could misbehave, so teardown is unconditional.
  useEffect(() => {
    if (!open) {
      teardown();
      setState('idle');
      setLevel(0);
      return;
    }
    void begin();
    return teardown;
    // Intentionally keyed on `open` alone: `begin` is recreated on every render, and depending on
    // it would reopen the microphone continuously.
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, actions.length]);

  /** Close the panel and tell the server the session is over. */
  const end = useCallback((): void => {
    const id = session?.id;
    teardown();
    if (id) {
      void api.v1.me.athena.voice[':id'].$delete({ param: { id } }).catch(() => undefined);
    }
    onOpenChange(false);
  }, [onOpenChange, session?.id, teardown]);

  const timeline = [...(priorQ.data?.items ?? []), ...history, ...turns];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else end();
      }}
    >
      <DialogContent presentation={{ kind: 'centered', size: 'large' }} data-voice-panel>
        <DialogHeader>
          <DialogTitle>Talking with Athena</DialogTitle>
          <DialogDescription>
            This is the same conversation you have everywhere else — on the web, over email, and on
            the phone.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <VoiceStatus state={state} level={level} />

          {notice ? (
            <p
              role="alert"
              className="bg-error-container text-on-error-container rounded-md px-3 py-2"
            >
              <Text token="body-medium" tone="inherit">
                {notice}
              </Text>
            </p>
          ) : null}

          <Surface
            tone="card"
            shape="medium"
            pad="comfortable"
            className="flex flex-col gap-3"
            data-voice-transcript
          >
            {timeline.length === 0 && actions.length === 0 ? (
              <Text token="body-medium" tone="muted">
                Say something — this is where the conversation appears.
              </Text>
            ) : null}
            {timeline.map((turn) => (
              <VoiceTurn key={turn.id} turn={turn} />
            ))}
            {actions.map((action) => (
              <VoiceAction key={`${action.id}-${action.status}`} action={action} />
            ))}
            <div ref={endRef} />
          </Surface>
        </DialogBody>

        <DialogFooter>
          <ControlGroup className="justify-between">
            <Text token="label-small" tone="muted" numeric>
              {session ? `Conversation ${session.conversationId.slice(-6)}` : 'Connecting…'}
            </Text>
            <Button variant="secondary" onClick={end}>
              <PhoneOff aria-hidden="true" />
              End voice
            </Button>
          </ControlGroup>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The state pill and the live input indicator. */
function VoiceStatus({
  state,
  level,
}: {
  readonly state: VoiceSessionState;
  readonly level: number;
}): JSX.Element {
  const listening = state === 'listening';
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg px-4 py-3',
        listening ? 'bg-primary-container text-on-primary-container' : surfaceToneColor('canvas'),
      )}
      data-voice-state={state}
    >
      <span aria-hidden="true" className="flex size-6 items-center justify-center">
        {state === 'speaking' ? (
          <SoundWave className="size-5" />
        ) : state === 'thinking' ? (
          <Sparkles className="size-5" />
        ) : listening ? (
          <Mic className="size-5" />
        ) : (
          <MicOff className="size-5" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Text token="label-large" tone="inherit">
          {STATE_LABEL[state]}
        </Text>
        <InputMeter level={level} active={listening} />
      </div>
    </div>
  );
}

/** How many bars the meter draws. */
const METER_BARS = 24;

/**
 * A live reading of microphone energy.
 *
 * @remarks
 * Every bar is always laid out at the same size; only its opacity changes with the level, so the
 * meter never reflows and nothing about it grows on interaction. `aria-hidden` because the state
 * label beside it already says "Listening" — a screen reader does not need the waveform.
 */
function InputMeter({
  level,
  active,
}: {
  readonly level: number;
  readonly active: boolean;
}): JSX.Element {
  const lit = Math.round(level * METER_BARS);
  return (
    <div aria-hidden="true" className="flex h-3 items-center gap-0.5" data-voice-level={lit}>
      {Array.from({ length: METER_BARS }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-full w-1 rounded-full',
            active ? 'bg-current' : 'bg-outline-variant',
            index < lit ? 'opacity-100' : 'opacity-25',
          )}
        />
      ))}
    </div>
  );
}

/** One spoken line in the timeline. */
function VoiceTurn({ turn }: { readonly turn: VoiceTurnOut }): JSX.Element {
  const mine = turn.role === 'user';
  return (
    <div className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <Text token="label-small" tone="muted">
        {mine ? 'You' : 'Athena'}
        {turn.channel === 'phone' ? ' · phone' : ''}
        {turn.interrupted ? ' · cut short' : ''}
      </Text>
      <p
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2',
          mine
            ? 'bg-secondary-container text-on-secondary-container'
            : cn(surfaceToneColor('floating'), 'text-on-surface'),
        )}
      >
        <Text token="body-medium" tone="inherit">
          {turn.text}
        </Text>
      </p>
    </div>
  );
}

/** One action, rendered from the moment it starts. */
function VoiceAction({ action }: { readonly action: VoiceActionOut }): JSX.Element {
  return (
    <div className="flex items-center gap-2" data-voice-action={action.status}>
      <Sparkles
        aria-hidden="true"
        className={
          action.status === 'running' ? 'text-primary size-4' : 'text-on-surface-variant size-4'
        }
      />
      <Text token="body-small" tone="muted">
        {action.summary}
      </Text>
    </div>
  );
}

export default VoiceMode;
