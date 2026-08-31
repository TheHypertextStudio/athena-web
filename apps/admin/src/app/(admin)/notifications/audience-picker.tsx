'use client';

import { ActorAvatar } from '@docket/ui/components';
import { Check, Search, X } from '@docket/ui/icons';
import { Badge, Input, Stack, Surface, Text } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';
import { useDebounced } from '@/lib/use-debounced';
import type { NotificationAnnouncementDraft } from './notification-console-model';

/** How many matches the search offers at a time. */
const SEARCH_LIMIT = 8;

/** Users matching a search term, for picking announcement recipients. */
function searchDef(search: string) {
  return apiQueryOptions(
    [...queryKeys.userList({ search }), 'audience'],
    () =>
      api.admin.users.$get({
        query: { search, limit: String(SEARCH_LIMIT), offset: '0' },
      }),
    'Could not search users.',
    { staleTime: STALE.static },
  );
}

/** Props for {@link AudiencePicker}. */
export interface AudiencePickerProps {
  /** Whether the announcement targets one recipient or several. */
  readonly audienceType: Extract<NotificationAnnouncementDraft['audienceType'], 'user' | 'users'>;
  /** The comma-separated user ids currently selected. */
  readonly value: string;
  /** Store a new comma-separated selection. */
  readonly onChange: (value: string) => void;
}

/**
 * Choose announcement recipients by name.
 *
 * @remarks
 * The audience was a free-text box that an operator typed raw user ids into, with no way to check
 * whether an id belonged to the person they meant — and the announcement it addresses is a message
 * that actually reaches someone. Recipients are now searched by name or email and picked from real
 * accounts, each shown with its avatar and address.
 *
 * The stored value stays a comma-separated list of ids, so the draft model and the create payload
 * are unchanged; only the way an operator arrives at that list is different.
 *
 * @param props - See {@link AudiencePickerProps}.
 * @returns the recipient picker.
 */
export function AudiencePicker({
  audienceType,
  value,
  onChange,
}: AudiencePickerProps): JSX.Element {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 250);
  const results = useApiListQuery({
    ...searchDef(debouncedSearch),
    enabled: debouncedSearch.trim().length > 0,
  });

  const selectedIds = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const multiple = audienceType === 'users';

  function toggle(userId: string): void {
    if (selectedIds.includes(userId)) {
      onChange(selectedIds.filter((id) => id !== userId).join(', '));
      return;
    }
    onChange(multiple ? [...selectedIds, userId].join(', ') : userId);
  }

  return (
    <Stack gap={2}>
      <Input
        type="search"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
        placeholder={multiple ? 'Search people to add' : 'Search for a person'}
        aria-label="Search recipients"
      />

      <SelectedRecipients ids={selectedIds} onRemove={toggle} />

      <SearchResults
        searching={debouncedSearch.trim().length > 0}
        loading={results.isFetching}
        users={results.data?.items ?? []}
        selectedIds={selectedIds}
        onToggle={toggle}
      />
    </Stack>
  );
}

/** The recipients chosen so far, each removable. */
function SelectedRecipients({
  ids,
  onRemove,
}: {
  readonly ids: readonly string[];
  readonly onRemove: (id: string) => void;
}): JSX.Element | null {
  if (ids.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {ids.map((id) => (
        <Badge key={id} variant="secondary" className="gap-1">
          <span className="max-w-40 truncate font-mono">{id}</span>
          <button
            type="button"
            aria-label={`Remove recipient ${id}`}
            onClick={() => {
              onRemove(id);
            }}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

/** The accounts matching the current search. */
function SearchResults({
  searching,
  loading,
  users,
  selectedIds,
  onToggle,
}: {
  readonly searching: boolean;
  readonly loading: boolean;
  readonly users: readonly { id: string; name: string; email: string }[];
  readonly selectedIds: readonly string[];
  readonly onToggle: (id: string) => void;
}): JSX.Element | null {
  if (!searching) {
    return (
      <Text as="p" token="body-small" tone="muted">
        <Search aria-hidden="true" className="mr-1 inline size-3.5" />
        Search by name or email to pick recipients.
      </Text>
    );
  }

  if (users.length === 0 && !loading) {
    return (
      <Text as="p" token="body-small" tone="muted">
        No account matches that search.
      </Text>
    );
  }

  return (
    <Surface tone="card" shape="small" pad="tight">
      <Stack gap={0} as="ul">
        {users.map((user) => (
          <li key={user.id}>
            <button
              type="button"
              aria-pressed={selectedIds.includes(user.id)}
              className="hover:bg-surface-container-high focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
              onClick={() => {
                onToggle(user.id);
              }}
            >
              <ActorAvatar kind="human" name={user.name || user.email} size={20} />
              <span className="flex min-w-0 flex-1 flex-col">
                <Text as="span" token="body-small" truncate>
                  {user.name || user.email}
                </Text>
                <Text as="span" token="label-small" tone="muted" truncate>
                  {user.email}
                </Text>
              </span>
              {selectedIds.includes(user.id) ? (
                <Check aria-hidden="true" className="size-4 shrink-0" />
              ) : null}
            </button>
          </li>
        ))}
      </Stack>
    </Surface>
  );
}

/** Props for {@link BroadcastWarning}. */
export interface BroadcastWarningProps {
  /** How many people the estimate says would receive this, when an estimate exists. */
  readonly recipientCount: number | undefined;
}

/**
 * The standing warning shown while an announcement is addressed to everyone.
 *
 * @remarks
 * "All users" sits in the same dropdown as "One user", one option apart, and is the only audience
 * whose blast radius is the entire product. Saying so while the draft is being written is worth
 * more than a dialog at the end, which arrives after the decision has already been made.
 *
 * @param props - See {@link BroadcastWarningProps}.
 * @returns the warning.
 */
export function BroadcastWarning({ recipientCount }: BroadcastWarningProps): JSX.Element {
  return (
    <Surface tone="card" shape="small" pad="comfortable">
      <Stack gap={1}>
        <Text as="p" token="label-large" tone="error">
          Addressed to every Docket user
        </Text>
        <Text as="p" token="body-small" tone="muted">
          {recipientCount === undefined
            ? 'Create the draft to see how many people this reaches before sending it.'
            : `${recipientCount.toLocaleString()} people receive this on the channels you selected.`}
        </Text>
      </Stack>
    </Surface>
  );
}
