interface PendingLockRequest {
  readonly mode: 'shared' | 'exclusive';
  readonly callback: (lock: Lock) => unknown;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

interface LockState {
  shared: number;
  exclusive: boolean;
  readonly queue: PendingLockRequest[];
}

/** A deterministic FIFO implementation of the shared/exclusive part of the Web Locks API. */
export class FakeLockManager {
  readonly states = new Map<string, LockState>();
  rejectRequests = false;

  /** Queue one lock request and settle it after the callback releases the lock. */
  request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> {
    if (this.rejectRequests) return Promise.reject(new Error('Lock manager refused the request'));
    const mode = options.mode ?? 'exclusive';
    const state = this.states.get(name) ?? { shared: 0, exclusive: false, queue: [] };
    this.states.set(name, state);
    const immediatelyUnavailable =
      state.exclusive || state.queue.length > 0 || (mode === 'exclusive' && state.shared > 0);
    if (options.ifAvailable && immediatelyUnavailable) return Promise.resolve(callback(null));
    return new Promise<T>((resolve, reject) => {
      state.queue.push({
        mode,
        callback,
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
      });
      this.pump(name, state);
    });
  }

  /** Grant the next exclusive request or the next contiguous group of shared requests. */
  private pump(name: string, state: LockState): void {
    if (state.exclusive || state.queue.length === 0) return;
    const first = state.queue[0];
    if (first === undefined) return;
    if (first.mode === 'exclusive') {
      if (state.shared > 0) return;
      state.queue.shift();
      state.exclusive = true;
      this.run(name, state, first);
      return;
    }
    while (state.queue[0]?.mode === 'shared') {
      const request = state.queue.shift();
      if (request === undefined) return;
      state.shared += 1;
      this.run(name, state, request);
    }
  }

  /** Run one granted callback and release its lock after the callback settles. */
  private run(name: string, state: LockState, request: PendingLockRequest): void {
    Promise.resolve(request.callback({ name, mode: request.mode }))
      .then(request.resolve, request.reject)
      .finally(() => {
        if (request.mode === 'exclusive') state.exclusive = false;
        else state.shared -= 1;
        this.pump(name, state);
      });
  }
}
