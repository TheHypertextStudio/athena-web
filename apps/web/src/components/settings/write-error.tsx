/**
 * `settings` — what a surface renders when a write it accepted did not land.
 *
 * @remarks
 * The read side of this problem has {@link LoadFailure}. The write side was worse, because a
 * failed write leaves the screen *lying*: optimistic state has already moved, the row shows the
 * new name, the checkbox shows the new value — and then the server refuses and nothing says so.
 * The next render quietly snaps it back, which reads as the product undoing your work at random.
 *
 * Pages here own several mutations at once — Labels has six — and in practice at most one is in
 * flight, because each is driven by a distinct control. So they share one slot rather than
 * reserving a line each: {@link firstWriteError} picks whichever write failed, and the caller
 * renders it once.
 *
 * Pass only application-owned fallbacks. `userErrorMessage` already strips provider and exception
 * text, and the boundary is enforced by
 * `packages/test-utils/tests/workspace-policies/web-error-source-policy.test.ts`.
 *
 * @example
 * ```tsx
 * const writeError = firstWriteError([
 *   [updateLabel, 'Could not save that label.'],
 *   [removeLabel, 'Could not delete that label.'],
 * ]);
 * return <>{writeError ? <WriteError message={writeError} /> : null}</>;
 * ```
 */
import type { JSX } from 'react';

import { userErrorMessage } from '@/lib/problem';

/** The part of a mutation result {@link firstWriteError} reads. */
export interface WriteLike {
  /** Whether the most recent attempt rejected. */
  readonly isError: boolean;
  /** The rejection, resolved to application copy by `userErrorMessage`. */
  readonly error: unknown;
}

/**
 * The first failed write, in the caller's stated priority order.
 *
 * @param entries - Mutations paired with the copy to use when the error carries none.
 * @returns application-owned copy for the first failed write, or null when every write succeeded.
 */
export function firstWriteError(entries: readonly (readonly [WriteLike, string])[]): string | null {
  const failed = entries.find(([mutation]) => mutation.isError);
  return failed === undefined ? null : userErrorMessage(failed[0].error, failed[1]);
}

/** Props for {@link WriteError}. */
export interface WriteErrorProps {
  /** Application-owned copy naming what could not be saved. */
  readonly message: string;
}

/**
 * A failed write, stated where the reader is already looking.
 *
 * @param props - The {@link WriteErrorProps}.
 * @returns the rendered alert.
 */
export function WriteError({ message }: WriteErrorProps): JSX.Element {
  return (
    <p role="alert" className="text-error text-body-medium">
      {message}
    </p>
  );
}
