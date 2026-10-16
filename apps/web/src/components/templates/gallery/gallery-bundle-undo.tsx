'use client';
import type { JSX } from 'react';
import type {
  WorkTemplateCopyBundle,
  WorkTemplateCopyUndoResult,
} from '@docket/work/template-gallery-contract';
import { Button, Surface } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';

/** Actual aggregate reversal state; a click alone never marks a persisted copy undone. */
export interface GalleryBundleUndoState {
  readonly pending: boolean;
  readonly error: string | null;
  readonly outcome: WorkTemplateCopyUndoResult | null;
  readonly onUndo: () => void;
}
/** Offer the real copy reversal and describe only its returned retained definitions. */
export function GalleryBundleUndo({
  bundle,
  state,
}: {
  readonly bundle: WorkTemplateCopyBundle;
  readonly state: GalleryBundleUndoState;
}): JSX.Element {
  return (
    <section aria-label="Copy reversal" className="flex min-w-0 flex-col gap-3">
      {bundle.receipt.state === 'installed' ? (
        <div>
          <Button variant="ghost-destructive" disabled={state.pending} onClick={state.onUndo}>
            {state.pending ? 'Undoing…' : 'Undo this copy'}
          </Button>
          <p className="text-body-small text-on-surface-variant">
            Work already created and definitions with later edits remain recoverable.
          </p>
        </div>
      ) : null}
      {state.error ? (
        <InlineBanner tone="critical" title="Could not undo this copy">
          {state.error}
        </InlineBanner>
      ) : null}
      {state.outcome?.retained.length ? (
        <Surface as="section" shape="medium" tone="well" pad="roomy">
          <h2 className="text-title-medium">Definitions kept</h2>
          <ul className="flex flex-col gap-3">
            {state.outcome.retained.map((entry) => (
              <li key={entry.workTypeId}>
                <p className="text-body-medium">
                  {bundle.entries.find((copy) => copy.workTypeId === entry.workTypeId)?.template
                    ?.definition.name ?? 'A definition'}
                </p>
                <p className="text-body-small text-on-surface-variant">
                  {entry.reason === 'changed_since'
                    ? 'Kept because this definition changed after it was copied.'
                    : 'Kept because this definition is being used.'}
                </p>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}
    </section>
  );
}
