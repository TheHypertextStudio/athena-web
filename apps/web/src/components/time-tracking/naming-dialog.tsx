'use client';

/**
 * The two moments the timer asks what you are working on.
 *
 * @remarks
 * One component, two uses, because they are the same question: *"what is this?"* — asked once at
 * the start, and asked again at the end when the start went unanswered. Keeping them one
 * component is what stops the confirm rules drifting apart, and those rules are the point:
 *
 * - The confirm control is disabled while the name is empty **or only whitespace**, so a spacebar
 *   cannot get past it.
 * - Escape and the backdrop dismiss the dialog and change nothing. Finishing is refused, not
 *   silently completed and not silently discarded — a timer that quietly ended because someone
 *   pressed Escape is exactly the loss this dialog exists to prevent.
 */
import {
  Button,
  ControlGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Text,
} from '@docket/ui/primitives';
import { type JSX, type SyntheticEvent, useEffect, useState } from 'react';

/** Props for {@link NamingDialog}. */
export interface NamingDialogProps {
  readonly open: boolean;
  /** Called with `false` on Escape, backdrop, or Cancel — never with a side effect. */
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  /** Pre-fills the field, e.g. the current name when finishing. */
  readonly initialName?: string;
  /** Resolves when the name has been accepted; the dialog stays open if it throws. */
  readonly onConfirm: (name: string) => Promise<void>;
  /** Application-owned copy for a failure, or null. */
  readonly error?: string | null;
}

/**
 * Ask for the name of the work being tracked.
 *
 * @param props - See {@link NamingDialogProps}.
 * @returns the modal dialog.
 */
export function NamingDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  initialName = '',
  onConfirm,
  error = null,
}: NamingDialogProps): JSX.Element {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed on each opening rather than once at mount: the dialog stays mounted between uses, and
  // a stale field would otherwise offer the previous session's name for this one.
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const named = name.trim().length > 0;

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    if (!named || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(name.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Field label="What are you working on?" {...(error ? { error } : {})}>
              <Input
                autoFocus
                controlSize="lg"
                value={name}
                placeholder="Rewrite the onboarding email"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <Text as="p" token="body-small" tone="muted" className="mt-2">
              This becomes a normal task in your workspace — you can assign, schedule and complete
              it like any other.
            </Text>
          </div>
          <DialogFooter>
            <ControlGroup controlSize="xl">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!named || submitting}>
                {confirmLabel}
              </Button>
            </ControlGroup>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
