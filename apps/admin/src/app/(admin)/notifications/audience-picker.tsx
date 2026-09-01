'use client';

import { ActorAvatar, PickerList } from '@docket/ui/components';
import type { PickerOption } from '@docket/ui/components';
import { Chip, Row, Stack, Surface, Text } from '@docket/ui/primitives';
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
 * Built on the shared {@link PickerList}, which already separates the four states this needs — idle,
 * loading, no-match, and results — and brings the roving keyboard navigation a hand-rolled list
 * does not. `filter="none"` because the API has already narrowed the rows; a second local pass
 * would drop matches the server deliberately returned.
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

  const options: readonly PickerOption[] = (results.data?.items ?? []).map((user) => ({
    value: user.id,
    label: user.name || user.email,
    hint: user.email,
    icon: <ActorAvatar kind="human" name={user.name || user.email} size={20} />,
  }));

  function toggle(userId: string): void {
    if (selectedIds.includes(userId)) {
      onChange(selectedIds.filter((id) => id !== userId).join(', '));
      return;
    }
    onChange(multiple ? [...selectedIds, userId].join(', ') : userId);
  }

  return (
    <Stack gap={2}>
      <SelectedRecipients ids={selectedIds} onRemove={toggle} />
      <PickerList
        options={options}
        selected={multiple ? selectedIds : (selectedIds[0] ?? null)}
        onSelect={toggle}
        multiple={multiple}
        filter="none"
        loading={results.isFetching}
        query={search}
        onQueryChange={setSearch}
        searchPlaceholder={multiple ? 'Search people to add' : 'Search for a person'}
        idleText="Search by name or email to pick recipients."
        emptyText="No account matches that search."
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
    <Row gap={1} align="center" className="flex-wrap">
      {ids.map((id) => (
        <Chip
          key={id}
          variant="input"
          avatar={<ActorAvatar kind="human" name={id} size={16} />}
          onRemove={() => {
            onRemove(id);
          }}
          removeLabel={`Remove recipient ${id}`}
        >
          {id}
        </Chip>
      ))}
    </Row>
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
