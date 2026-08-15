'use client';

/**
 * `publishing` — a value you are meant to carry somewhere else, with the affordance that carries it.
 *
 * @remarks
 * A DNS record is only ever read in order to be retyped at a registrar, and retyping
 * `_docket-verify.updates.example.org` by hand is how verification fails. So the value is not text
 * that happens to be selectable — it is a control: the whole value is the click target, and a
 * trailing icon says so before anyone tries.
 *
 * The acknowledgement lands on the control that was pressed and, for anyone not watching it, in a
 * polite live region — the app's one copy-feedback contract.
 *
 * @see {@link useCopyFeedback} for the acknowledgement state machine.
 */
import { Check, Copy } from '@docket/ui/icons';
import type { JSX } from 'react';

import { useCopyFeedback } from '@/lib/use-copy-feedback';

/** Props for {@link CopyValue}. */
export interface CopyValueProps {
  /** The exact text placed on the clipboard, rendered verbatim. */
  readonly value: string;
  /** What this value is, for the control's accessible name (e.g. "Name", "Value"). */
  readonly label: string;
}

/**
 * One copyable value: press anywhere on it to put it on the clipboard.
 *
 * @param props - The {@link CopyValueProps}.
 * @returns The rendered control.
 */
export function CopyValue({ value, label }: CopyValueProps): JSX.Element {
  const { state, announcement, copyText } = useCopyFeedback({
    copiedMessage: `${label} copied.`,
  });

  return (
    <>
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        data-copy-state={state}
        onClick={() => {
          void copyText(value);
        }}
        className="hover:bg-surface-container-high focus-visible:ring-ring group -mx-2 flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-2"
      >
        <span className="text-body-small text-on-surface min-w-0 flex-1 font-mono break-all">
          {value}
        </span>
        {state === 'copied' ? (
          <Check aria-hidden className="text-primary size-4 shrink-0" />
        ) : (
          <Copy
            aria-hidden
            className="text-on-surface-variant size-4 shrink-0 opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </button>
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
