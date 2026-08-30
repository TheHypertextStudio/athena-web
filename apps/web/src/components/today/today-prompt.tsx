'use client';

/**
 * `today/today-prompt` — the hybrid capture / ask-Athena box at the top of Today.
 *
 * @remarks
 * The single entry point for getting work INTO Docket from the daily surface, wiring the
 * the direct capture path and the one shared personal Athena rail:
 *
 * - **Capture** (`POST /v1/orgs/:orgId/capture`) — the explicit secondary destination. Free text becomes a real
 *   task in the active workspace (its default team's entry state, attached to the live
 *   cycle when one covers today). `Enter` submits.
 * - **Ask Athena** opens the personal rail with this workspace and draft attached. The rail creates
 *   and supervises the work; Today does not grow its own mini session UI.
 *
 * **The two destinations are not a preference, and the box must not pretend otherwise.** Capture is
 * a deterministic insert: `deriveTitle` takes the first non-empty line, truncates it, and puts the
 * rest in the description — no parsing, no decomposition, no agent. Athena spawns a task, an agent,
 * and an approval loop. Hiding which one is armed would be lying about consequences, which is why
 * the destination is named on the control rather than inferred.
 *
 * That is also why the placeholder no longer says "paste a plan". In Task mode a twelve-line
 * braindump becomes *one* task titled by line one; only Athena decomposes it.
 *
 * **The destination is a segmented toggle, not a hidden chevron.** The mode used to live in a bare
 * chevron beside the send button, so the same `Enter` keystroke inserted a row or started an agent
 * depending on state you had to infer. Both destinations now sit in one {@link TabList} track with
 * the armed one filled — a single control with two positions, rather than two chips that happen to
 * be adjacent. Athena is the resting choice and stays so across visits.
 *
 * The whole thing is one field, rendered through {@link fieldSurface} — the same recipe every
 * input, textarea, and select in the product uses — so it lands inside the closed variant set
 * rather than inventing a fourth look. It was previously a bare textarea over a hairline rule with
 * controls floating beneath it, which read as three unrelated elements stacked in a column rather
 * than as something you type into.
 *
 * `filled`, not `outlined`. A composer needs presence, and in a tonal system that comes from a
 * surface step; a hand-added border was reaching for emphasis with the one device the design system
 * spends most sparingly. `ringOn: 'within'` because the wrapper owns the focus ring for a textarea
 * nested inside it.
 *
 * Its inset and its type both sit above the control scale deliberately. That scale describes form
 * fields — a 40px control with `body-medium` text — and this is not one: it is the primary thing a
 * person does on this page, and at a form field's proportions it read as a utility strip under the
 * masthead. The box grows through padding rather than reserved rows, so every pixel of it is
 * somewhere you can type.
 *
 * A line, not a card. The bordered box with a toolbar along its bottom edge made the page's first
 * element a form, and its inner text sat inset from the column every other line on the page aligns
 * to. This shares the page's left edge, so it lines up by construction rather than by a negative
 * margin.
 */
import { ArrowUp, Paperclip, Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Chip,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Row,
  Stack,
  Tab,
  TabList,
  Tabs,
  fieldSurface,
} from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import {
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
  useCallback,
  useRef,
  useState,
} from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { useMentionOrgId } from '@/components/mentions/use-mention-org';
import { api } from '@/lib/api';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { startViewTransition } from '@/lib/view-transition';
import MentionTextarea from '@/components/mentions/mention-textarea';

/** A successful capture: enough to confirm AND point at the created task. */
interface CaptureNotice {
  /** The created task's title (echoed so the confirmation feels concrete). */
  title: string;
  /** Where the task lives, for the follow-the-work link. */
  href: string;
}

/**
 * Where this box sends what you typed.
 *
 * @remarks
 * Athena is always the resting destination because this is the day's standing Athena field. Task
 * capture stays available as an explicit secondary destination for the current visit, but never
 * replaces Athena when someone returns to Today.
 */
type CaptureMode = 'task' | 'athena';

/** Props for {@link TodayPrompt}. */
export interface TodayPromptProps {
  /** The active workspace's org id (capture/session target); `null` before resolution. */
  orgId: string | null;
  /** The active workspace's display name (shown so the target is explicit). */
  orgLabel: string;
  /** Invoked after a successful capture so the host can refresh the plan. */
  onCaptured?: (() => void) | undefined;
  /**
   * Expand this page into the Athena conversation, carrying the draft with it.
   *
   * @remarks
   * When the host supplies this, Athena mode stays on the page instead of opening the ⌘J rail, and
   * the draft rides along. Same conversation either way — the rail and the page render the one
   * persistent thread — so this only decides where it appears, not how many there are.
   */
  onStartSession?: ((draft: string) => void) | undefined;
}

/** The hybrid prompt box: capture a task, or hand the thought to Athena. */
export function TodayPrompt({
  orgId,
  orgLabel,
  onCaptured,
  onStartSession,
}: TodayPromptProps): JSX.Element {
  const { openAthena } = useAthenaPanel();
  const [text, setText] = useState('');
  const mentionOrgId = useMentionOrgId(orgId);
  const [busy, setBusy] = useState<'capture' | null>(null);
  const [notice, setNotice] = useState<CaptureNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<CaptureMode>('athena');
  const [files, setFiles] = useState<readonly File[]>([]);
  const [dropping, setDropping] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);

  // No empty-workspace fork. This box used to run a `tasks` probe purely to decide whether to
  // show an onboarding heading, a different placeholder, swapped button emphasis, and a different
  // Enter target — four behaviours diverging on a network read, so the same keystroke did
  // different things depending on a count the person typing could not see. One box, one
  // behaviour, one fewer request.
  const canSubmit = orgId !== null && text.trim().length > 0 && busy === null;

  const capture = useCallback(async (): Promise<void> => {
    if (!orgId || !text.trim()) return;
    setBusy('capture');
    setError(null);
    setNotice(null);
    try {
      const res = await api.v1.orgs[':orgId'].capture.$post({
        param: { orgId },
        json: { text: text.trim() },
      });
      if (!res.ok) {
        setError(
          userErrorMessage(
            await readProblemError(res, 'Could not capture that.'),
            'Could not capture that.',
          ),
        );
        return;
      }
      const created = await res.json();
      // Attachments hang off a task, so they can only be sent once the task exists. A failure here
      // must not read as a failed capture — the task is already saved either way.
      for (const file of files) {
        const body = new FormData();
        body.append('file', file);
        // Relative, like `api` itself — the web app proxies `/v1/*` to the API, and the typed
        // client cannot express a multipart body.
        const upload = await fetch(`/v1/orgs/${orgId}/tasks/${created.id}/attachments/upload`, {
          method: 'POST',
          body,
          credentials: 'include',
        });
        if (!upload.ok) setError('Task saved, but a file could not be attached.');
      }
      setFiles([]);
      setText('');
      setNotice({
        title: created.title,
        href: `/orgs/${orgId}/tasks/${created.id}`,
      });
      onCaptured?.();
    } catch (caught) {
      setError(userErrorMessage(caught, 'Could not capture that.'));
    } finally {
      setBusy(null);
    }
  }, [orgId, orgLabel, text, files, onCaptured]);

  const askAthena = useCallback((): void => {
    if (!orgId || !text.trim()) return;
    setError(null);
    setNotice(null);
    const draft = text.trim();
    setText('');
    // Exactly one surface, never both. A host that shows the conversation itself takes the draft
    // and expands in place; without one, the ⌘J rail is the door. Doing both put the rail on top of
    // the page that had just become the same conversation.
    // The composer and the session it becomes share `today-composer`, so the box a person typed
    // into morphs into the conversation rather than being replaced by it.
    startViewTransition(() => {
      if (onStartSession) onStartSession(draft);
      else openAthena({ workspaceId: orgId, workspaceName: orgLabel }, draft);
    });
  }, [openAthena, orgId, orgLabel, text, onStartSession]);

  /** Send the draft wherever the active mode points. */
  const submit = useCallback((): void => {
    if (mode === 'athena') askAthena();
    else void capture();
  }, [mode, askAthena, capture]);

  const setMode = useCallback((next: CaptureMode): void => {
    setModeState(next);
  }, []);

  /**
   * Stage picked files, and arm Task mode.
   *
   * @remarks
   * A file can only be attached to a task — the Athena rail starts a session from a draft string
   * and has nowhere to put one. Switching automatically beats disabling the control half the time
   * or accepting a file the armed destination would silently drop.
   */
  const acceptFiles = useCallback((picked: readonly File[]): void => {
    if (picked.length === 0) return;
    setFiles((current) => [...current, ...picked]);
    setModeState('task');
  }, []);

  const pickFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      acceptFiles([...(event.target.files ?? [])]);
      event.target.value = '';
    },
    [acceptFiles],
  );

  const removeFile = useCallback((at: number): void => {
    setFiles((current) => current.filter((_, index) => index !== at));
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      if (!canSubmit) return;
      // Enter sends in the active mode. ⌘/Ctrl+Enter sends too, and is the chord to rely on: while
      // the `@` menu is open `MentionTextarea` swallows a plain Enter to pick a mention and lets
      // only this one through (see `mention-textarea.tsx`).
      submit();
    },
    [canSubmit, submit],
  );

  /** The first few attachments stay visible; the rest collapse behind a count. */
  const VISIBLE_FILES = 3;
  const shownFiles = files.slice(0, VISIBLE_FILES);
  const hiddenFiles = files.slice(VISIBLE_FILES);

  return (
    // 600px, centred. This is the entry point to every kind of work the page can start — a task, a
    // scheduling request, an interactive planning session — so it sits on the page's axis at a
    // width you can read a sentence in, rather than stretching to whatever the column happens to be.
    <Stack gap={2} className="mx-auto w-full max-w-[600px]">
      {/* No heading and no explainer above the box. What used to sit here — a rhetorical
          "What's on your plate?" over two sentences describing what pasting does — was the field
          narrating itself to the person already using it. */}
      <div
        className={cn(
          fieldSurface({
            variant: 'filled',
            controlSize: 'xl',
            multiline: true,
            ringOn: 'within',
          }),
          // `fieldSurface` pads for a form field — `py-2` around a 40px control. A composer is the
          // primary thing on this page and has to invite writing, so it takes a composition field's
          // inset instead. Height comes from padding, never from phantom rows.
          'flex flex-col gap-2 rounded-xl px-3 py-3',
          // Files can be dropped anywhere on the box, not just onto a button.
          dropping && 'ring-primary bg-surface-container-highest ring-2',
        )}
        style={{ viewTransitionName: 'today-composer' }}
        onDragOver={(event) => {
          if (![...event.dataTransfer.types].includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropping(true);
        }}
        onDragLeave={(event) => {
          // Only when the pointer leaves the box itself, not on every child boundary it crosses.
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropping(false);
        }}
        onDrop={(event) => {
          if (![...event.dataTransfer.types].includes('Files')) return;
          event.preventDefault();
          setDropping(false);
          acceptFiles([...event.dataTransfer.files]);
        }}
      >
        <MentionTextarea
          value={text}
          onChange={(next) => {
            setText(next);
            if (notice) setNotice(null);
          }}
          {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
          insertMode="context"
          onKeyDown={onKeyDown}
          // One line at rest, growing to fit whatever is pasted in.
          rows={1}
          autoGrow
          maxRows={16}
          placeholder={mode === 'athena' ? 'Ask Athena about today…' : 'What task needs capturing?'}
          aria-label={mode === 'athena' ? 'Ask Athena about today' : 'Add a task'}
          disabled={orgId === null}
          className="placeholder:text-on-surface-variant text-body-large w-full resize-none bg-transparent px-1 outline-none disabled:opacity-50"
        />

        {/* Attachments sit under the prompt and above the bar, so what you dropped reads as part of
            the message rather than as a property of the send button. Past three they collapse into
            a count, and the row never grows tall enough to push the bar off-screen. */}
        {files.length > 0 ? (
          <Row gap={2} className="flex-wrap px-1">
            <ControlGroup controlSize="sm" wrap>
              {shownFiles.map((file, index) => (
                <Chip
                  key={`${file.name}:${String(index)}`}
                  variant="input"
                  icon={<Paperclip />}
                  removeLabel={`Remove ${file.name}`}
                  onRemove={() => {
                    removeFile(index);
                  }}
                  className="max-w-52"
                >
                  {file.name}
                </Chip>
              ))}
              {hiddenFiles.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Chip variant="assist" leadingNone="overflow-count">
                      +{hiddenFiles.length}
                    </Chip>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" width="sm">
                    {hiddenFiles.map((file, index) => (
                      <DropdownMenuItem
                        key={`${file.name}:${String(index)}`}
                        onSelect={() => {
                          removeFile(VISIBLE_FILES + index);
                        }}
                      >
                        Remove {file.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </ControlGroup>
          </Row>
        ) : null}

        {/* One group, one height, one 8px rhythm. */}
        <ControlGroup controlSize="sm" className="gap-2">
          <input
            ref={filePicker}
            type="file"
            multiple
            className="hidden"
            onChange={pickFiles}
            aria-hidden="true"
            tabIndex={-1}
          />
          <Button
            type="button"
            variant="ghost"
            iconOnly
            aria-label="Add files"
            disabled={orgId === null}
            onClick={() => {
              filePicker.current?.click();
            }}
          >
            <Plus aria-hidden="true" />
          </Button>
          <Tabs
            value={mode}
            tone="accent"
            onValueChange={(next) => {
              setMode(next as CaptureMode);
            }}
          >
            <TabList label="Send this to">
              <Tab value="athena">Athena</Tab>
              <Tab value="task">Task</Tab>
            </TabList>
          </Tabs>
          <Button
            type="button"
            iconOnly
            disabled={!canSubmit}
            onClick={submit}
            aria-label={mode === 'task' ? 'Add task' : 'Ask Athena'}
            // Same corner as the box it sits in, so the control reads as part of the field.
            className="ml-auto rounded-xl"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </ControlGroup>
      </div>
      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <p className="text-error text-body-small">{error}</p>
        ) : notice ? (
          <p className="text-on-surface-variant text-body-small">
            Added <span className="text-on-surface font-medium">“{notice.title}”</span> —{' '}
            <Button asChild variant="link" controlSize="sm">
              <Link href={notice.href}>view task</Link>
            </Button>
          </p>
        ) : null}
      </div>
    </Stack>
  );
}
