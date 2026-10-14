'use client';

/**
 * One field that both creates work and attaches work that already exists.
 *
 * @remarks
 * A person adding a Project to an Initiative does not know in advance whether the Project exists
 * yet — that is a fact about the workspace, not about their intent. So this asks once: type the
 * name. What already exists appears as you type and one keystroke attaches it; what does not,
 * Enter creates. The surface that had a quick-add row, a "Link project" button and a "Link
 * program" button now has one input, and nothing to choose between before you start typing.
 *
 * The fast path is unchanged and deliberately protected: type, Enter, keep typing. The field
 * clears and keeps focus in the same turn as the submit, so entering five Projects is five names
 * and five Enters, exactly as it was when this was only a quick-add.
 */
import { InlineBanner, MenuListbox, MenuOption } from '@docket/ui/components';
import type { PickerOption } from '@docket/ui/components';
import { Plus } from '@docket/ui/icons';
import { Input, Popover, PopoverAnchor, PopoverContent } from '@docket/ui/primitives';
import type React from 'react';
import { type JSX, type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';

/** One group of existing things this field can attach. */
export interface AddOrLinkGroup {
  /** Heading for the group, e.g. "Projects". */
  readonly label: string;
  /** The candidates, already narrowed to what is not attached yet. */
  readonly options: readonly PickerOption[];
  /** Attach the chosen candidate. */
  readonly onSelect: (value: string) => void;
}

/** Props for {@link AddOrLinkRow}. */
export interface AddOrLinkRowProps {
  /** Whether the viewer may add; false renders nothing. */
  readonly canEdit: boolean;
  /** The vocabulary-skinned singular noun this field creates, lowercase — e.g. `"project"`. */
  readonly noun: string;
  /** Placeholder prompt. */
  readonly placeholder: string;
  /** Create one from the typed name; resolves once persisted. */
  readonly onCreate: (name: string) => Promise<void>;
  /** The existing things this field can attach instead, in the order they are offered. */
  readonly groups: readonly AddOrLinkGroup[];
  /** Whether the candidate lists are still arriving. */
  readonly loading?: boolean;
}

/** A flattened, keyboard-navigable candidate. */
interface Candidate {
  readonly groupLabel: string;
  readonly option: PickerOption;
  readonly onSelect: (value: string) => void;
}

/** A submission the server refused, kept so its words are not lost. */
interface RefusedSubmission {
  readonly key: number;
  readonly value: string;
  /** Application-owned copy for why it did not land. */
  readonly reason: string;
}

/** The most candidates worth showing before a person should narrow the query themselves. */
const MAX_CANDIDATES = 6;

/**
 * Narrow every group to what matches the query, flattened in group order.
 *
 * @param groups - The candidate groups.
 * @param query - What has been typed so far.
 * @returns At most {@link MAX_CANDIDATES} candidates, or none for an empty query.
 */
function matchCandidates(groups: readonly AddOrLinkGroup[], query: string): readonly Candidate[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const found: Candidate[] = [];
  for (const group of groups) {
    for (const option of group.options) {
      if (found.length >= MAX_CANDIDATES) return found;
      if (!option.label.toLowerCase().includes(needle)) continue;
      found.push({ groupLabel: group.label, option, onSelect: group.onSelect });
    }
  }
  return found;
}

/** Props for the private {@link CandidateList}. */
interface CandidateListProps {
  readonly listId: string;
  readonly query: string;
  readonly candidates: readonly Candidate[];
  readonly active: number;
  readonly loading: boolean;
  readonly onPick: (candidate: Candidate) => void;
}

/** What already exists, offered under the field as it is typed. */
function CandidateList({
  listId,
  query,
  candidates,
  active,
  loading,
  onPick,
}: CandidateListProps): JSX.Element | null {
  if (candidates.length === 0) return null;

  return (
    <MenuListbox id={listId} ariaLabel={`Existing matches for ${query.trim()}`} aria-busy={loading}>
      {candidates.map((candidate, index) => (
        <MenuOption
          key={`${candidate.groupLabel}-${candidate.option.value}`}
          id={`${listId}-${String(index)}`}
          active={index === active}
          onSelect={() => {
            onPick(candidate);
          }}
          trailing={
            <span className="text-on-surface-variant text-label-medium">
              Link {candidate.groupLabel.toLowerCase()}
            </span>
          }
        >
          {candidate.option.label}
        </MenuOption>
      ))}
    </MenuListbox>
  );
}

/** Props for the private {@link RefusedList}. */
interface RefusedListProps {
  readonly noun: string;
  readonly refused: readonly RefusedSubmission[];
  readonly onRetry: (entry: RefusedSubmission) => void;
  readonly onDiscard: (entry: RefusedSubmission) => void;
}

/** Names the server refused, kept on screen so nobody has to remember what they typed. */
function RefusedList({ noun, refused, onRetry, onDiscard }: RefusedListProps): JSX.Element | null {
  if (refused.length === 0) return null;

  return (
    <ul aria-label={`Unsent ${noun}s`} className="flex flex-col gap-1">
      {refused.map((entry) => (
        <li key={entry.key}>
          <InlineBanner
            tone="critical"
            density="compact"
            title={entry.reason}
            action={{
              label: 'Retry',
              ariaLabel: `Retry adding ${entry.value}`,
              onSelect: () => {
                onRetry(entry);
              },
            }}
            dismissLabel={`Discard ${entry.value}`}
            onDismiss={() => {
              onDiscard(entry);
            }}
          >
            <span data-refused-title className="block truncate">
              {entry.value}
            </span>
          </InlineBanner>
        </li>
      ))}
    </ul>
  );
}

/** Everything the field needs to behave, lifted out of its markup. */
interface AddOrLinkState {
  readonly value: string;
  readonly active: number;
  readonly candidates: readonly Candidate[];
  readonly open: boolean;
  /** True when the typed name already names something the list is offering. */
  readonly duplicate: boolean;
  readonly refused: readonly RefusedSubmission[];
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onChange: (next: string) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly pick: (candidate: Candidate) => void;
  readonly retry: (entry: RefusedSubmission) => void;
  readonly discard: (entry: RefusedSubmission) => void;
}

/**
 * The field's behaviour: match, navigate, create or link, and keep refusals.
 *
 * @param groups - The candidate groups.
 * @param noun - The singular noun, for the refusal sentence.
 * @param onCreate - Persist a new one from the typed name.
 * @returns The {@link AddOrLinkState}.
 */
function useAddOrLink(
  groups: readonly AddOrLinkGroup[],
  noun: string,
  onCreate: (name: string) => Promise<void>,
): AddOrLinkState {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [refused, setRefused] = useState<readonly RefusedSubmission[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  const candidates = useMemo(() => matchCandidates(groups, value), [groups, value]);
  const open = showSuggestions && candidates.length > 0;
  // An exact name match means the thing already exists, so creating a second one by that name is
  // almost never what was meant — the list is already offering the real one.
  const duplicate = candidates.some(
    (candidate) => candidate.option.label.toLowerCase() === value.trim().toLowerCase(),
  );

  const submit = (submitted: string): void => {
    void onCreate(submitted).catch((caught: unknown) => {
      const reason = userErrorMessage(caught, `Could not add that ${noun}.`);
      setRefused((current) => [...current, { key: nextKey.current++, value: submitted, reason }]);
    });
  };

  const reset = (): void => {
    // Cleared and refocused before anything is awaited: the field belongs to the next entry, and
    // whatever the network does next concerns the name captured above.
    setValue('');
    setActive(-1);
    inputRef.current?.focus();
  };

  const create = (): void => {
    const submitted = value.trim();
    if (submitted.length === 0) return;
    reset();
    submit(submitted);
  };

  const pick = (candidate: Candidate): void => {
    reset();
    candidate.onSelect(candidate.option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    handleAddOrLinkKey(event, {
      open,
      candidates,
      active,
      duplicate,
      setActive,
      reset,
      pick,
      create,
    });
  };

  return {
    value,
    active,
    candidates,
    open,
    duplicate,
    refused,
    inputRef,
    onOpenChange: setShowSuggestions,
    onChange: (next) => {
      setShowSuggestions(true);
      setValue(next);
      setActive(-1);
    },
    onKeyDown,
    pick,
    retry: (entry) => {
      setRefused((current) => current.filter((item) => item.key !== entry.key));
      submit(entry.value);
    },
    discard: (entry) => {
      setRefused((current) => current.filter((item) => item.key !== entry.key));
    },
  };
}

/** The state needed to navigate existing work or submit the name being drafted. */
interface AddOrLinkKeys {
  readonly open: boolean;
  readonly candidates: readonly Candidate[];
  readonly active: number;
  readonly duplicate: boolean;
  readonly setActive: React.Dispatch<React.SetStateAction<number>>;
  readonly reset: () => void;
  readonly pick: (candidate: Candidate) => void;
  readonly create: () => void;
}

/** Route keyboard navigation while the input retains focus. */
function handleAddOrLinkKey(event: KeyboardEvent<HTMLInputElement>, state: AddOrLinkKeys): void {
  if (event.nativeEvent.isComposing) return;
  if (state.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    // Include one empty slot so arrowing beyond the last match restores Enter-to-create.
    const slots = state.candidates.length + 1;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    state.setActive((current) => (current + step + slots) % slots);
    return;
  }
  if (event.key === 'Escape' && state.open) {
    event.preventDefault();
    state.reset();
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const chosen = state.candidates[state.active];
  if (chosen) state.pick(chosen);
  else if (!state.duplicate) state.create();
}

/** An inline composer that links what exists and creates what does not. */
export function AddOrLinkRow({
  canEdit,
  noun,
  placeholder,
  onCreate,
  groups,
  loading = false,
}: AddOrLinkRowProps): JSX.Element | null {
  const state = useAddOrLink(groups, noun, onCreate);
  const listId = useId();

  if (!canEdit) return null;

  return (
    <div className="flex flex-col gap-1">
      <Popover open={state.open} onOpenChange={state.onOpenChange}>
        <PopoverAnchor asChild>
          <div>
            <Input
              ref={state.inputRef}
              leading={<Plus aria-hidden className="size-4" />}
              variant="filled"
              controlSize="lg"
              value={state.value}
              role="combobox"
              aria-expanded={state.open}
              aria-controls={state.open ? listId : undefined}
              aria-activedescendant={
                state.open && state.active >= 0 && state.active < state.candidates.length
                  ? `${listId}-${String(state.active)}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-label={`Add or link a ${noun}`}
              placeholder={placeholder}
              onFocus={() => {
                state.onOpenChange(true);
              }}
              onChange={(event) => {
                state.onChange(event.target.value);
              }}
              onKeyDown={state.onKeyDown}
              className="w-full"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          width="xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (event.target === state.inputRef.current) event.preventDefault();
          }}
        >
          <CandidateList
            listId={listId}
            query={state.value}
            candidates={state.candidates}
            active={state.active}
            loading={loading}
            onPick={state.pick}
          />
        </PopoverContent>
      </Popover>
      <RefusedList
        noun={noun}
        refused={state.refused}
        onRetry={state.retry}
        onDiscard={state.discard}
      />
    </div>
  );
}
