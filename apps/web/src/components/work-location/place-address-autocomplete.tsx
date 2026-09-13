'use client';

/** Accessible address autocomplete for one saved place. */
import type {
  WorkPlaceGeocodeCandidate,
  WorkPlaceGeocodeResult,
  WorkPlaceGeocodeSearchOut,
} from '@docket/planning/work-location-contract';
import { MenuListbox, MenuOption } from '@docket/ui/components';
import { Input, Surface } from '@docket/ui/primitives';
import { type JSX, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { useRemoteSearch } from '@/lib/use-remote-search';
import type { RemoteSearchState } from '@/lib/use-remote-search';

const SEARCH_DEBOUNCE_MS = 400;

/** Props for {@link PlaceAddressAutocomplete}. */
export interface PlaceAddressAutocompleteProps {
  /** Address text currently shown in the form. */
  readonly value: string;
  /** Receive every direct text edit. */
  readonly onValueChange: (value: string) => void;
  /** Receive the permanent address and point after a candidate resolves. */
  readonly onResolved: (result: WorkPlaceGeocodeResult) => void;
  /** Prevent input and selection while the place is saving. */
  readonly disabled?: boolean;
}

function handleAutocompleteKey(
  event: KeyboardEvent<HTMLInputElement>,
  candidates: readonly WorkPlaceGeocodeCandidate[],
  active: WorkPlaceGeocodeCandidate | null,
  setActiveIndex: (update: (current: number) => number) => void,
  choose: (candidate: WorkPlaceGeocodeCandidate) => void,
): void {
  if (candidates.length === 0) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setActiveIndex((current) => (current + 1) % candidates.length);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setActiveIndex((current) => (current - 1 + candidates.length) % candidates.length);
  } else if (event.key === 'Enter' && active) {
    event.preventDefault();
    choose(active);
  } else if (event.key === 'Escape') {
    setActiveIndex(() => 0);
  }
}

function AddressSearchFeedback(props: {
  readonly menuVisible: boolean;
  readonly search: RemoteSearchState<WorkPlaceGeocodeSearchOut>;
  readonly candidates: readonly WorkPlaceGeocodeCandidate[];
  readonly activeIndex: number;
  readonly listboxId: string;
  readonly resolveError: Error | null;
  readonly choose: (candidate: WorkPlaceGeocodeCandidate) => void;
  readonly setActiveIndex: (index: number) => void;
}): JSX.Element {
  return (
    <>
      {props.menuVisible ? (
        <Surface tone="floating" shape="small" className="max-h-64 overflow-y-auto py-1">
          {props.search.pending ? (
            <p className="text-on-surface-variant text-body-small px-4 py-3" role="status">
              Searching addresses…
            </p>
          ) : (
            <MenuListbox id={props.listboxId} ariaLabel="Address suggestions">
              {props.candidates.map((candidate, index) => (
                <MenuOption
                  id={`${props.listboxId}-${String(index)}`}
                  key={candidate.id}
                  active={index === props.activeIndex}
                  onActiveChange={() => {
                    props.setActiveIndex(index);
                  }}
                  onSelect={() => {
                    props.choose(candidate);
                  }}
                >
                  {candidate.address}
                </MenuOption>
              ))}
            </MenuListbox>
          )}
          {props.search.data?.attribution ? (
            <p className="text-on-surface-variant text-body-small px-4 py-2">
              {props.search.data.attribution}
            </p>
          ) : null}
        </Surface>
      ) : null}
      {props.search.error ? (
        <span role="alert" className="text-error text-body-small">
          {props.search.error}
        </span>
      ) : null}
      {props.resolveError ? (
        <span role="alert" className="text-error text-body-small">
          {userErrorMessage(props.resolveError, 'Docket could not use that address. Try again.')}
        </span>
      ) : null}
    </>
  );
}

function useAcceptedAddress(value: string) {
  const [acceptedAddress, setAcceptedAddress] = useState(value);
  const directEditRef = useRef(false);

  useEffect(() => {
    if (directEditRef.current) {
      directEditRef.current = false;
      return;
    }
    setAcceptedAddress(value);
  }, [value]);

  return { acceptedAddress, setAcceptedAddress, directEditRef };
}

function useAddressResolution(
  onResolved: (result: WorkPlaceGeocodeResult) => void,
  setAcceptedAddress: (value: string) => void,
) {
  return useApiMutation({
    mutationFn: (candidate: WorkPlaceGeocodeCandidate) =>
      unwrap(
        () =>
          api.v1.me['work-location'].places.geocoding.resolutions.$post({
            json: { id: candidate.id, address: candidate.address },
          }),
        'Docket could not use that address. Try again.',
      ),
    onSuccess: (result) => {
      setAcceptedAddress(result.address);
      onResolved(result);
    },
  });
}

/** Search temporary candidates and permanently resolve the selected one. */
export function PlaceAddressAutocomplete({
  value,
  onValueChange,
  onResolved,
  disabled = false,
}: PlaceAddressAutocompleteProps): JSX.Element {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const { acceptedAddress, setAcceptedAddress, directEditRef } = useAcceptedAddress(value);
  const searchValue = value === acceptedAddress ? '' : value;
  const search = useRemoteSearch({
    query: searchValue,
    debounceMs: SEARCH_DEBOUNCE_MS,
    minChars: 3,
    enabled: !disabled,
    key: queryKeys.workLocationGeocoding,
    fetch: (term) =>
      api.v1.me['work-location'].places.geocoding.search.$get({ query: { query: term } }),
    fallbackMessage: 'Docket could not search addresses. Try again.',
  });
  const candidates = search.term === searchValue.trim() ? (search.data?.items ?? []) : [];
  const active = candidates[activeIndex] ?? null;
  const resolve = useAddressResolution(onResolved, setAcceptedAddress);

  useEffect(() => {
    setActiveIndex(0);
  }, [search.term]);

  const choose = (candidate: WorkPlaceGeocodeCandidate): void => {
    if (!resolve.isPending) resolve.mutate(candidate);
  };
  const menuVisible = searchValue.trim().length >= 3 && (search.pending || candidates.length > 0);

  return (
    <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
      Address (optional)
      <Input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={menuVisible}
        aria-controls={menuVisible ? listboxId : undefined}
        aria-activedescendant={active ? `${listboxId}-${String(activeIndex)}` : undefined}
        autoComplete="off"
        disabled={disabled || resolve.isPending}
        maxLength={240}
        value={value}
        placeholder="10 Library Lane"
        onChange={(event) => {
          directEditRef.current = true;
          setActiveIndex(0);
          setAcceptedAddress('');
          onValueChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (menuVisible) {
            handleAutocompleteKey(event, candidates, active, setActiveIndex, choose);
          }
        }}
      />
      <AddressSearchFeedback
        menuVisible={menuVisible}
        search={search}
        candidates={candidates}
        activeIndex={activeIndex}
        listboxId={listboxId}
        resolveError={resolve.error}
        choose={choose}
        setActiveIndex={setActiveIndex}
      />
    </label>
  );
}
