'use client';
import type { JSX } from 'react';
import type {
  WorkTemplateCopyBundle,
  WorkTemplateCopyUndoResult,
} from '@docket/work/template-gallery-contract';
import { Button, Surface } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { workTemplateHref } from '../work-template-navigation';
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
  orgId,
}: {
  readonly bundle: WorkTemplateCopyBundle;
  readonly state: GalleryBundleUndoState;
  readonly orgId?: string;
}): JSX.Element {
  return (
    <section aria-label="Copy reversal" className="flex min-w-0 flex-col gap-3">
      {bundle.receipt.state === 'installed' ? (
        <div>
          <Button
            wrapLabel
            variant="ghost-destructive"
            className="px-3 sm:px-0"
            disabled={state.pending}
            onClick={state.onUndo}
          >
            {state.pending ? 'Undoing…' : 'Undo this copy'}
          </Button>
          <p className="text-body-small text-on-surface-variant px-3 sm:px-0">
            Work already created and templates you edited stay available.
          </p>
        </div>
      ) : null}
      {state.error ? (
        <InlineBanner tone="critical" title="Could not undo this copy">
          {state.error}
        </InlineBanner>
      ) : null}
      {state.outcome?.retained.length ? (
        <Surface as="section" shape="medium" tone="well" pad="comfortable">
          <h2 className="text-title-medium">Templates kept</h2>
          <ul className="flex flex-col gap-3">
            {state.outcome.retained.map((entry) => (
              <li key={entry.workTypeId}>
                <Link
                  className="text-body-medium text-primary underline"
                  href={`${workTemplateHref(orgId ?? '')}/${entry.workTypeId}?returnBundle=${bundle.receipt.bundleId}`}
                >
                  {bundle.entries.find((copy) => copy.workTypeId === entry.workTypeId)?.template
                    ?.definition.name ?? 'A template'}
                </Link>
                <p className="text-body-small text-on-surface-variant">
                  {entry.reason === 'changed_since'
                    ? 'Kept because this template changed after it was copied.'
                    : 'Kept because this template is being used.'}
                </p>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}
    </section>
  );
}
