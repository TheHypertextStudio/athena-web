import type { ApplyIntent, FieldSnapshot, IntentHandle, IntentStatus } from './types';

type Listener = () => void;

interface Entry<T> {
  readonly version: number;
  readonly value: T;
  readonly deliver: ApplyIntent<T>['deliver'];
  status: IntentStatus;
  active: boolean;
}

interface FieldState<T> {
  authoritative: T;
  nextVersion: number;
  latest: Entry<T> | undefined;
  queued: Entry<T> | undefined;
  inFlight: Entry<T> | undefined;
}

const identityKey = (scope: string, field: string): string => `${scope}\u0000${field}`;

/**
 * Pure field-version journal for instant local mutation projection.
 *
 * New values are visible synchronously. Transport is serialized per field, while stale
 * settlements only update the authoritative base and never clear a newer local intent.
 */
export class IntentJournal<T> {
  private readonly fields = new Map<string, FieldState<T>>();
  private readonly listeners = new Set<Listener>();

  /** Number of fields with a live local intent. */
  public get size(): number {
    return [...this.fields.values()].filter((state) => state.latest !== undefined).length;
  }

  /** Set or refresh the server-authoritative value beneath any local overlay. */
  public setAuthoritative(scope: string, field: string, value: T): void {
    const state = this.state(scope, field, value);
    state.authoritative = value;
    this.emit();
  }

  /** Reconcile fresh server data while preserving a live local overlay. */
  public reconcile(scope: string, field: string, value: T): void {
    this.setAuthoritative(scope, field, value);
  }

  /** Read the effective value for a field. */
  public getSnapshot(scope: string, field: string): FieldSnapshot<T> {
    const state = this.fields.get(identityKey(scope, field));
    if (!state) {
      throw new Error(`No authoritative value registered for ${scope}.${field}`);
    }
    const latest = state.latest;
    return {
      value: latest?.value ?? state.authoritative,
      authoritative: state.authoritative,
      status: latest?.status ?? 'settled',
      version: latest?.version ?? state.nextVersion,
    };
  }

  /** Apply a local value immediately and enqueue its delivery. */
  public apply(input: ApplyIntent<T>): IntentHandle<T> {
    const state = this.state(input.scope, input.field, input.value);
    const entry: Entry<T> = {
      version: ++state.nextVersion,
      value: input.value,
      deliver: input.deliver,
      status: 'syncing',
      active: false,
    };
    state.latest = entry;
    state.queued = entry;
    this.emit();
    this.dispatch(input.scope, input.field, state);
    return this.handle(input.scope, input.field, entry);
  }

  /** Subscribe to local projection changes. */
  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private state(scope: string, field: string, initial: T): FieldState<T> {
    const key = identityKey(scope, field);
    const existing = this.fields.get(key);
    if (existing) return existing;
    const created: FieldState<T> = {
      authoritative: initial,
      nextVersion: 0,
      latest: undefined,
      queued: undefined,
      inFlight: undefined,
    };
    this.fields.set(key, created);
    return created;
  }

  private handle(scope: string, field: string, entry: Entry<T>): IntentHandle<T> {
    return {
      version: entry.version,
      value: entry.value,
      retry: () => {
        return this.apply({ scope, field, value: entry.value, deliver: entry.deliver });
      },
      discard: () => {
        this.discard(scope, field, entry.version);
      },
      settleSuccess: (authoritative) => {
        this.settle(scope, field, entry, true, authoritative);
      },
      settleFailure: () => {
        this.settle(scope, field, entry, false);
      },
    };
  }

  private dispatch(scope: string, field: string, state: FieldState<T>): void {
    const entry = state.queued;
    if (!entry || state.inFlight) return;
    state.queued = undefined;
    entry.active = true;
    state.inFlight = entry;
    try {
      const result = entry.deliver(entry.value, entry.version);
      Promise.resolve(result).then(
        (authoritative) => {
          this.settle(scope, field, entry, true, authoritative);
        },
        () => {
          this.settle(scope, field, entry, false);
        },
      );
    } catch {
      this.settle(scope, field, entry, false);
    }
  }

  private settle(
    scope: string,
    field: string,
    entry: Entry<T>,
    success: boolean,
    authoritative?: T,
  ): void {
    const state = this.fields.get(identityKey(scope, field));
    if (!state?.latest && !state?.inFlight) return;
    if (!entry.active && state.latest !== entry) return;
    entry.active = false;
    if (state.inFlight === entry) state.inFlight = undefined;
    if (success && authoritative !== undefined) state.authoritative = authoritative;
    if (state.latest === entry) {
      if (success) {
        entry.status = 'settled';
        state.latest = undefined;
      } else {
        entry.status = 'needs_attention';
      }
    }
    this.emit();
    this.dispatch(scope, field, state);
    this.gc(scope, field, state);
  }

  private discard(scope: string, field: string, version: number): void {
    const state = this.fields.get(identityKey(scope, field));
    if (state?.latest?.version !== version) return;
    state.latest = undefined;
    if (state.queued?.version === version) state.queued = undefined;
    this.emit();
    this.gc(scope, field, state);
  }

  private gc(scope: string, field: string, state: FieldState<T>): void {
    if (!state.latest && !state.queued && !state.authoritative)
      this.fields.delete(identityKey(scope, field));
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Create a pure, dependency-free intent journal. */
export function createIntentJournal<T>(): IntentJournal<T> {
  return new IntentJournal<T>();
}
