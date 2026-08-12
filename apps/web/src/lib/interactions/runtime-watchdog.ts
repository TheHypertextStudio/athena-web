/** A named, metadata-only development/test failure from asynchronous action observation. */
export interface RuntimeWatchdogFailure {
  /** The invariant that was violated. */
  readonly code: 'unowned-async-work' | 'missing-painted-acknowledgement';
  /** The stable registered action identifier; never a user, entity, route, or invocation value. */
  readonly actionId: string;
}

/** The explicit ownership state supplied when asynchronous action work begins. */
export type RuntimeWatchdogOwner =
  | {
      /** A root or child receipt that can be checked without serializing its local correlation value. */
      readonly invocationId: string;
      /** Reports whether a rendered owner has earned painted acknowledgement. */
      readonly isAcknowledged: () => boolean;
    }
  | {
      /** An explicit background exception that intentionally has no rendered receipt owner. */
      readonly autonomous: true;
    }
  | undefined;

/** A scheduled development/test watchdog observation. */
export interface RuntimeWatchdogObservation {
  /** Cancel observation during explicit owner teardown. */
  readonly cleanup: () => void;
  /** Complete observation without allowing async settlement to masquerade as acknowledgement. */
  readonly settle: () => void;
}

/** Construction options for {@link createRuntimeWatchdog}. */
export interface RuntimeWatchdogOptions {
  /** Explicit mode for deterministic tests; production installs no reporter. */
  readonly environment?: 'development' | 'production' | 'test';
  /** Metadata-only development/test observer. */
  readonly onFailure?: (failure: RuntimeWatchdogFailure) => void;
  /** Injectable scheduler for deterministic watchdog tests. */
  readonly schedule?: (callback: () => void) => RuntimeWatchdogTimeout;
  /** Injectable timer cleanup for deterministic watchdog tests. */
  readonly clear?: (handle: RuntimeWatchdogTimeout) => void;
}

/** A browser or Node timer handle retained only until the local watchdog is cleaned up. */
export type RuntimeWatchdogTimeout = ReturnType<typeof globalThis.setTimeout> | number;

/** The local runtime watchdog contract. */
export interface RuntimeWatchdog {
  /** Observe user-initiated asynchronous work and report only named ownership failures. */
  readonly observeAsync: (
    actionId: string,
    owner: RuntimeWatchdogOwner,
  ) => RuntimeWatchdogObservation;
}

function reportsFailures(environment: RuntimeWatchdogOptions['environment']): boolean {
  return (environment ?? process.env.NODE_ENV) !== 'production';
}

/**
 * Create the metadata-only development/test watchdog for registered action work.
 *
 * @remarks
 * This intentionally has no production telemetry transport and never receives a receipt snapshot.
 * Its only observation is whether a rendered receipt owner acknowledged work before it settled or
 * reached the next watchdog task.
 */
export function createRuntimeWatchdog(options: RuntimeWatchdogOptions = {}): RuntimeWatchdog {
  const schedule = options.schedule ?? globalThis.setTimeout;
  const clear = options.clear ?? globalThis.clearTimeout;
  const enabled = reportsFailures(options.environment);

  return {
    observeAsync: (actionId, owner) => {
      if (!enabled) {
        return { cleanup: () => undefined, settle: () => undefined };
      }
      if (owner === undefined) {
        options.onFailure?.({ code: 'unowned-async-work', actionId });
        return { cleanup: () => undefined, settle: () => undefined };
      }
      if (!('invocationId' in owner)) {
        return { cleanup: () => undefined, settle: () => undefined };
      }
      const receiptOwner = owner;

      let reported = false;
      let cleaned = false;
      const reportMissingAcknowledgement = (): void => {
        if (reported || cleaned || receiptOwner.isAcknowledged()) return;
        reported = true;
        options.onFailure?.({ code: 'missing-painted-acknowledgement', actionId });
      };
      const handle: RuntimeWatchdogTimeout = schedule(reportMissingAcknowledgement);
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        clear(handle);
      };

      return {
        cleanup,
        settle: () => {
          reportMissingAcknowledgement();
          cleanup();
        },
      };
    },
  };
}
