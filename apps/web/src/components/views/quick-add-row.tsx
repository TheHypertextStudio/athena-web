'use client';

/**
 * `QuickAddRow` — the app's one inline "type a name, press Enter" composer.
 *
 * @remarks
 * The dashed-outline row that sits at the foot of a list and creates one more of whatever that list
 * holds, without a modal or a redirect. The host owns the actual create call via
 * {@link QuickAddRowProps.onAdd} — it supplies the contextual defaults (team, project, milestone…)
 * around the typed name — and names what is being created through
 * {@link QuickAddRowProps.noun}, which is the vocabulary-skinned singular the surrounding surface
 * already uses ("task", "issue", "milestone"). Renders nothing when the viewer can't create.
 *
 * The composer is built for someone entering several entries in a row, which is the whole reason it
 * exists rather than a dialog. It used to disable the field and wait for the round trip before
 * clearing — so between every two entries there was a dead input, focus had moved off it, and the
 * next Enter went nowhere. Now each submission captures its own name, the field clears and stays
 * focused in the same turn, and the next one can be typed while the previous is still in flight.
 *
 * Clearing before the server has agreed is only safe if a refusal gives the words back. It does,
 * but not by refilling the field: the field belongs to the next entry, and there can be more than
 * one refusal outstanding. Each refused submission becomes its own row with retry and discard, so
 * entering two names that both fail leaves both of them on screen — putting them back one at a time
 * into a single box means the second one silently overwrites nothing and is simply lost.
 */
import { Plus, RefreshCw, X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { type JSX, useRef, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';

/** Props for {@link QuickAddRow}. */
export interface QuickAddRowProps {
  /** Create one entry from the typed name; resolves once persisted. */
  onAdd: (value: string) => Promise<void>;
  /** Whether the viewer may create; false renders nothing. */
  canEdit: boolean;
  /** The vocabulary-skinned singular for what this row creates, lowercase — e.g. `"task"`. */
  noun: string;
  /** Placeholder prompt; defaults to `Add a {noun}…`. */
  placeholder?: string;
}

/** A submission the server refused, kept so its words are not lost. */
interface RefusedSubmission {
  /** Identity for the row, so two refusals of the same text stay distinct. */
  readonly key: number;
  /** Exactly what was typed. */
  readonly value: string;
  /**
   * Application-owned copy for why it did not land.
   *
   * @remarks
   * Named `reason` rather than `message` on purpose: the source policy forbids reading `.message`
   * in production UI because that is how provider and exception prose leaks onto a screen. This
   * value has already been through `userErrorMessage`, so it is ours — but a field called
   * `message` is indistinguishable from the thing the rule exists to catch.
   */
  readonly reason: string;
}

/** An inline composer that stays put across entries. */
export function QuickAddRow({
  onAdd,
  canEdit,
  noun,
  placeholder = `Add a ${noun}…`,
}: QuickAddRowProps): JSX.Element | null {
  const [value, setValue] = useState('');
  const [refused, setRefused] = useState<readonly RefusedSubmission[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  if (!canEdit) return null;

  /** Submit one captured name, parking it as retryable if the server refuses. */
  const submit = (submitted: string): void => {
    void onAdd(submitted).catch((caught: unknown) => {
      const reason = userErrorMessage(caught, `Could not add that ${noun}.`);
      setRefused((current) => [...current, { key: nextKey.current++, value: submitted, reason }]);
    });
  };

  const add = (): void => {
    const submitted = value.trim();
    if (submitted.length === 0) return;

    // Cleared and refocused in this turn, before anything is awaited. Whatever the network does
    // next concerns the name captured above, not the field, which now belongs to the next entry.
    setValue('');
    inputRef.current?.focus();
    submit(submitted);
  };

  /** Try a refused submission again, removing its row first so a second failure re-adds it. */
  const retry = (entry: RefusedSubmission): void => {
    setRefused((current) => current.filter((item) => item.key !== entry.key));
    submit(entry.value);
  };

  return (
    <div className="flex flex-col gap-1">
      <form
        className="border-outline-variant focus-within:border-primary flex items-center gap-2 rounded-lg border border-dashed px-3 transition-colors"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Plus aria-hidden className="text-on-surface-variant size-4 shrink-0" />
        <input
          ref={inputRef}
          value={value}
          aria-label={`New ${noun} name`}
          placeholder={placeholder}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            // Explicit Enter handling (not just implicit form submit) so a single keystroke always adds.
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          className="text-body-medium text-on-surface placeholder:text-on-surface-variant h-11 flex-1 bg-transparent outline-none"
        />
      </form>

      {refused.length === 0 ? null : (
        <ul aria-label={`Unsent ${noun}s`} className="flex flex-col gap-1">
          {refused.map((entry) => (
            <li
              key={entry.key}
              className="border-error/40 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span data-refused-title className="text-on-surface text-body-medium truncate">
                  {entry.value}
                </span>
                <span role="alert" className="text-error text-body-small">
                  {entry.reason}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retry adding ${entry.value}`}
                onClick={() => {
                  retry(entry);
                }}
              >
                <RefreshCw aria-hidden className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Discard ${entry.value}`}
                onClick={() => {
                  setRefused((current) => current.filter((item) => item.key !== entry.key));
                }}
              >
                <X aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
