'use client';

/**
 * The "Post an update" composer at the top of {@link UpdatesPanel}.
 *
 * @remarks
 * Owns its own draft, health choice, and reset key — none of it is meaningful to the panel once a
 * post succeeds, so keeping it here rather than lifted keeps the panel's own state to the updates
 * feed it actually renders.
 */
import type { Health } from '@docket/work/capability-contract';
import { cn } from '@docket/ui';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useRef, useState } from 'react';

import { useActiveOrgIdOptional } from '@/components/active-org';
import { HEALTH_FILL_CLASS, HEALTH_LABEL } from '@/components/entity-display/health';
import { FreeformTextEditor } from '@/components/editor/freeform-text';

/** The selectable composer health values (empty string = "no change"). */
type HealthChoice = Health | '';

/** The composer's health options, in lifecycle order, plus the "no change" default. */
const HEALTH_OPTIONS: readonly { value: HealthChoice; label: string }[] = [
  { value: '', label: 'No health change' },
  { value: 'on_track', label: HEALTH_LABEL.on_track },
  { value: 'at_risk', label: HEALTH_LABEL.at_risk },
  { value: 'off_track', label: HEALTH_LABEL.off_track },
];

/** Resolve a composer health choice to its menu/trigger label. */
function choiceLabel(choice: HealthChoice): string {
  return HEALTH_OPTIONS.find((option) => option.value === choice)?.label ?? 'No health change';
}

/** Props for {@link HealthPicker}. */
interface HealthPickerProps {
  health: HealthChoice;
  onHealthChange: (next: HealthChoice) => void;
}

/** The "Set health" dropdown — a bordered trigger showing the chosen verdict's token dot. */
function HealthPicker({ health, onHealthChange }: HealthPickerProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-on-surface-variant text-body-medium">Set health</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            {health !== '' ? (
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', HEALTH_FILL_CLASS[health])}
              />
            ) : null}
            <span>{choiceLabel(health)}</span>
            <ChevronDown className="h-4 w-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width="sm">
          <DropdownMenuRadioGroup
            value={health}
            onValueChange={(next) => {
              onHealthChange(next as HealthChoice);
            }}
          >
            {HEALTH_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value || 'none'} value={option.value}>
                <span className="flex items-center gap-2">
                  {option.value !== '' ? (
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 rounded-full', HEALTH_FILL_CLASS[option.value])}
                    />
                  ) : null}
                  {option.label}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Props for {@link UpdatesComposer}. */
export interface UpdatesComposerProps {
  /** Whether a post is in flight. */
  posting: boolean;
  /** A post error to surface, if any. */
  postError: string | null;
  /**
   * Post a new update with an optional health verdict.
   *
   * @remarks
   * Returns a promise that settles with the write, so the composer can clear on success and
   * preserve the draft on failure. A rejection is expected to be reported through
   * {@link UpdatesComposerProps.postError}; the composer swallows it rather than re-reporting.
   */
  onPost: (body: string, health: Health | undefined) => Promise<void>;
  /**
   * Show the "Set health" control. Defaults to `true`; pass `false` on surfaces where health is
   * not update-driven (e.g. Project) so the composer posts a plain update.
   */
  showHealthComposer?: boolean;
}

/**
 * The "Post an update" composer.
 *
 * @param props - The {@link UpdatesComposerProps}.
 * @returns the rendered composer form.
 */
export function UpdatesComposer({
  posting,
  postError,
  onPost,
  showHealthComposer = true,
}: UpdatesComposerProps): JSX.Element {
  const [body, setBody] = useState('');
  const bodyRef = useRef('');
  const [composerKey, setComposerKey] = useState(0);
  const activeOrgId = useActiveOrgIdOptional();
  const [health, setHealth] = useState<HealthChoice>('');

  /**
   * Post the draft, clearing the composer only once the update is actually saved.
   *
   * @remarks
   * Clearing optimistically on submit reads fine until the post fails: the composer would surface
   * {@link UpdatesComposerProps.postError} over an empty box, having already thrown away the text
   * the author would need to retry. Awaiting the parent's write keeps a failed draft exactly where
   * it was — the error is recoverable instead of destructive.
   */
  async function submit(): Promise<void> {
    const trimmed = bodyRef.current.trim();
    if (trimmed.length === 0 || posting) return;
    try {
      await onPost(trimmed, health === '' ? undefined : health);
    } catch {
      // The parent owns the message and renders it through `postError`; keep the draft to retry.
      return;
    }
    bodyRef.current = '';
    setBody('');
    setComposerKey((current) => current + 1);
    setHealth('');
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="bg-surface-container-low flex flex-col gap-3 rounded-xl p-4"
    >
      <p className="text-on-surface text-label-large">Post an update</p>
      <FreeformTextEditor
        key={composerKey}
        value={body}
        onChange={(next) => {
          bodyRef.current = next;
          setBody(next);
        }}
        {...(activeOrgId === null ? {} : { mentionOrgId: activeOrgId })}
        ariaLabel="Post an update"
        placeholder="Share how this line of work is flowing — wins, risks, or what changed…"
        padding="p-3"
        className="bg-surface-container-high hover:bg-surface-container-highest min-h-20 rounded-lg transition-colors"
        disabled={posting}
        onSubmit={() => {
          void submit();
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {showHealthComposer ? (
          <HealthPicker health={health} onHealthChange={setHealth} />
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={posting || body.trim().length === 0}>
          {posting ? 'Posting…' : 'Post update'}
        </Button>
      </div>
      {postError ? (
        <p role="alert" className="text-error text-body-medium">
          {postError}
        </p>
      ) : null}
    </form>
  );
}
