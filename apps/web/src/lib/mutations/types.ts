/** Lifecycle of a field's local intent. */
export type IntentStatus = 'syncing' | 'needs_attention' | 'settled';

/** A field's currently rendered value and authoritative base. */
export interface FieldSnapshot<T> {
  readonly value: T;
  readonly authoritative: T;
  readonly status: IntentStatus;
  readonly version: number;
}

/** Identity of one independently mutable field. */
export interface FieldIdentity {
  readonly scope: string;
  readonly field: string;
}

/** Input for a local field patch. */
export interface ApplyIntent<T> extends FieldIdentity {
  readonly value: T;
  readonly deliver: (value: T, version: number) => Promise<T> | T;
}

/** Handle for the intent version created by {@link IntentJournal.apply}. */
export interface IntentHandle<T> {
  readonly version: number;
  readonly value: T;
  readonly retry: () => IntentHandle<T>;
  readonly discard: () => void;
  readonly settleSuccess: (authoritative?: T) => void;
  readonly settleFailure: () => void;
}
