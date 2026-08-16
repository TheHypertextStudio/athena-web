/**
 * `settings` — what a surface renders when a read it needed did not arrive.
 *
 * @remarks
 * Eleven settings surfaces independently wrote the same two lines: compute a specific,
 * application-owned message with `userErrorMessage`, then throw it away and render a fixed
 * sentence — "Workspace members are temporarily unavailable. We'll keep checking automatically."
 * The message was used as a boolean. That is not eleven mistakes; it is a missing component, and
 * the idiom filled the gap.
 *
 * Three things it fixes, in order of how much they cost the reader:
 *
 * - **The reason survives.** A 403 and a dropped connection are different problems with different
 *   next steps, and the reassuring sentence made them identical.
 * - **It does not promise a retry it cannot keep.** "We'll keep checking automatically" is true of
 *   a transient network failure and false of a permission error, where waiting is the one thing
 *   that will never work. Retry copy is opt-in via `retrying`.
 * - **It announces.** Every hand-rolled copy used `role="status"`, so assistive tech received the
 *   reassurance at polite priority and was never told anything had failed. A failed read is an
 *   alert.
 *
 * Pass only application-owned copy — `userErrorMessage(err, 'Could not load …')` — never an
 * exception message, a provider's `error_description`, or a Problem `detail`. That boundary is
 * enforced by `packages/test-utils/tests/workspace-policies/web-error-source-policy.test.ts`.
 *
 * @example
 * ```tsx
 * if (membersQ.isError) {
 *   return <LoadFailure message={userErrorMessage(membersQ.error, 'Could not load members.')} retrying />;
 * }
 * ```
 */
import type { JSX } from 'react';

/** Props for {@link LoadFailure}. */
export interface LoadFailureProps {
  /** Application-owned copy naming what could not be read. */
  readonly message: string;
  /**
   * Whether the underlying query keeps retrying on its own.
   *
   * @remarks
   * Only true for reads on the live/polling tier. Saying it where it is not true tells someone to
   * wait for a recovery that is never coming.
   */
  readonly retrying?: boolean;
}

/**
 * A failed read, stated rather than smoothed over.
 *
 * @param props - The {@link LoadFailureProps}.
 * @returns the rendered alert.
 */
export function LoadFailure({ message, retrying = false }: LoadFailureProps): JSX.Element {
  return (
    <p role="alert" className="text-error text-body-medium">
      {message}
      {retrying ? <span className="text-on-surface-variant"> Docket keeps trying.</span> : null}
    </p>
  );
}
