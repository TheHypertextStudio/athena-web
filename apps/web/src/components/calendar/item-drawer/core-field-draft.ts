'use client';

import { useCallback, useEffect, useState } from 'react';

import type { LocalInputOccurrence } from '../datetime-input';

interface RebasedField {
  readonly seed: string;
  readonly value: string;
}

/** Keep local edits while immediately adopting refreshed server values for untouched fields. */
export function useRebasedField(seed: string): readonly [string, (value: string) => void] {
  const [draft, setDraft] = useState<RebasedField>(() => ({ seed, value: seed }));
  const value = draft.value === draft.seed ? seed : draft.value;

  useEffect(() => {
    setDraft((current) => {
      const nextValue = current.value === current.seed ? seed : current.value;
      return current.seed === seed && current.value === nextValue
        ? current
        : { seed, value: nextValue };
    });
  }, [seed]);

  const setValue = useCallback(
    (nextValue: string): void => {
      setDraft({ seed, value: nextValue });
    },
    [seed],
  );
  return [value, setValue];
}

/** State and mutators for one atomically rebased datetime-local value and fold occurrence. */
export interface RebasedLocalTimeField {
  readonly wallValue: string;
  readonly occurrence: LocalInputOccurrence | null;
  readonly dirty: boolean;
  readonly setWallValue: (value: string) => void;
  readonly setOccurrence: (occurrence: LocalInputOccurrence) => void;
}

/** Keep a wall value and occurrence choice together across background item refetches. */
export function useRebasedLocalTimeField(
  seedWallValue: string,
  seedOccurrence: LocalInputOccurrence | null,
): RebasedLocalTimeField {
  const encode = (wallValue: string, occurrence: LocalInputOccurrence | null): string =>
    `${wallValue}\u0000${occurrence ?? ''}`;
  const seed = encode(seedWallValue, seedOccurrence);
  const [encoded, setEncoded] = useRebasedField(seed);
  const [wallValue = '', occurrenceValue = ''] = encoded.split('\u0000');
  const occurrence =
    occurrenceValue === 'earlier' || occurrenceValue === 'later' ? occurrenceValue : null;
  return {
    wallValue,
    occurrence,
    dirty: encoded !== seed,
    setWallValue: (value) => {
      setEncoded(encode(value, null));
    },
    setOccurrence: (nextOccurrence) => {
      setEncoded(encode(wallValue, nextOccurrence));
    },
  };
}
