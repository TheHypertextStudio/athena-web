'use client';

/**
 * Draft lifetime for the create composers: every open starts from a pristine form.
 *
 * @remarks
 * The create composers (task, project, program, initiative, cycle, team) are *controlled* by their
 * host page — the page owns `open` so its header button and its empty-state CTA drive the same
 * dialog — which means the composer component stays mounted for the life of the page. React state
 * declared inside it therefore outlives any single open→close cycle, and a reopened composer shows
 * whatever the last draft left behind.
 *
 * The obvious patch is to hand-reset each field when the dialog closes, and that is exactly what
 * these composers used to do. It failed in production for two structural reasons:
 *
 * 1. **It only covers the close paths that route through the wrapper.** A successful create closes
 *    the dialog by calling the host's `onOpenChange` prop directly — it never touches the composer's
 *    reset wrapper — so the single most common exit left the entire draft intact. Creating a project
 *    and reopening the composer showed the project you had just created, still typed in.
 * 2. **It is a hand-maintained list.** Every new field is a new `setX(...)` line somebody has to
 *    remember, in a block far away from the `useState` it mirrors. Nothing fails when it is missed.
 *
 * {@link withComposerReset} replaces that bookkeeping with a lifetime rule the type system and the
 * render tree enforce for free: the composer subtree is given a key that changes whenever the dialog
 * transitions closed→open, so React unmounts the previous instance and mounts a fresh one. *All*
 * state inside it — fields, property picks, in-flight/error flags, the shell's own discard
 * confirmation, and anything added later — is reconstructed from its initializers. There is no list
 * to maintain and no exit path that can bypass it, because the reset is keyed to entry, not exit.
 *
 * Resetting on *open* rather than on close also fixes a smaller papercut: a close-time reset blanks
 * the fields while the dialog is still animating away, so the draft visibly empties itself on the
 * way out. Keying to open leaves the closing dialog looking exactly as the user left it.
 *
 * State that must survive across opens belongs to the host page, above this boundary, or to the
 * TanStack Query cache — both of which sit outside the remounted subtree. In particular the option
 * rosters the pickers read (`useComposerOptions`) are query-backed, so a remount re-reads them from
 * cache rather than refetching.
 *
 * @example
 * ```tsx
 * export const CreateWidgetDialog = withComposerReset(function CreateWidgetComposer({
 *   open,
 *   onOpenChange,
 * }: CreateWidgetDialogProps): JSX.Element {
 *   const [name, setName] = useState(''); // cleared on every open, with no reset block
 *   return <ComposerShell open={open} onOpenChange={onOpenChange} … />;
 * });
 * ```
 */
import { type JSX, useState } from 'react';

/** The slice of composer props this boundary reads: the host-owned open state. */
export interface ComposerOpenProps {
  /** Whether the composer dialog is open (the host page owns this state). */
  open: boolean;
}

/**
 * A counter that advances every time `open` transitions from closed to open.
 *
 * @remarks
 * Used as a React `key`, this is what makes a fresh open mount a fresh composer. The transition is
 * detected during render and the counter is advanced with a same-component state update — React's
 * supported way to derive state from a prop change. React re-runs this component before committing,
 * so the new key is in place for the very render that opens the dialog, with no intermediate frame
 * showing the previous draft.
 *
 * The previous `open` value is held in *state* rather than a ref on purpose. A ref mutated during
 * render survives a render pass that React discards (which concurrent rendering is free to do,
 * and which StrictMode simulates), while the queued counter update would not — leaving the two
 * out of step and silently skipping the remount. Keeping both in state means they are discarded or
 * committed together.
 *
 * The counter deliberately does *not* advance on close: the closing dialog keeps its content while
 * it animates out.
 *
 * @param open - Whether the composer is currently open.
 * @returns the current generation, stable until the next open.
 */
function useOpenGeneration(open: boolean): number {
  const [generation, setGeneration] = useState(0);
  const [previousOpen, setPreviousOpen] = useState(open);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) setGeneration((current) => current + 1);
  }

  return generation;
}

/**
 * Bind a create composer's state lifetime to a single open of its dialog.
 *
 * @remarks
 * Wrap the composer at its export site so the exported component — the one every host page renders —
 * is always the managed one; there is no unwrapped variant a call site could reach for by mistake.
 * The wrapper is transparent: it forwards every prop and adds no markup.
 *
 * @typeParam P - The composer's props, which must include the host-owned `open` flag.
 * @param Composer - The stateful composer to remount on each open.
 * @returns a component with the same props whose state resets on every open.
 *
 * @see {@link ComposerShell} for the chrome these composers share.
 */
export function withComposerReset<P extends ComposerOpenProps>(
  Composer: (props: P) => JSX.Element,
): (props: P) => JSX.Element {
  return function ComposerResetBoundary(props: P): JSX.Element {
    const generation = useOpenGeneration(props.open);
    return <Composer key={generation} {...props} />;
  };
}
