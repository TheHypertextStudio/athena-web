'use client';

/**
 * `editor` — a document-style body for any entity: a quiet Markdown editor with a responsive,
 * auto-generated table of contents.
 *
 * @remarks
 * Generalized from the initiative-only document so Initiatives, Programs, and any future
 * document-first surface share one component instead of each cloning the editor + contents logic.
 * Nothing here is entity-specific: the caller supplies the value, edit permission, save handler,
 * and placeholder. The contents rail appears only once the body has two or more headings. Its
 * class names (`entity-document`, `entity-contents*`) are stable hooks a page's print stylesheet
 * can target.
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useRef } from 'react';

import {
  DocumentContentsDisclosure,
  DocumentContentsRail,
  useDocumentContents,
} from '@/components/editor/document-contents';
import { EditableFreeformText } from '@/components/editor/freeform-text';

import type { EditorContribution } from './editor-contribution';

/** Props for {@link EntityDocument}. */
export interface EntityDocumentProps {
  /** The Markdown body, or null/undefined when none has been written yet. */
  value: string | null | undefined;
  /** Whether the viewer may edit the body. */
  canEdit: boolean;
  /** Persist a non-empty Markdown value, or null to clear the body. */
  onSave: (value: string | null) => void;
  /** Notify the host when the reader activates the editable document. */
  onEditStart?: () => void;
  /** The quiet prompt shown before anything is written. */
  placeholder?: string;
  /**
   * Whether to generate a table of contents from the body's headings. Defaults to true.
   *
   * @remarks
   * Off for bodies that are short by nature. A contents rail beside two headings is navigation for
   * a distance nobody has to travel, and it costs a column of the measure to say so.
   */
  contents?: boolean;
  /** Feature behavior delegated to the editor without adding document-layout chrome. */
  contributions?: readonly EditorContribution[];
}

/** A document-style entity body with a responsive generated table of contents. */
export function EntityDocument({
  value,
  canEdit,
  onSave,
  onEditStart,
  placeholder = 'Add a description',
  contents = true,
  contributions = [],
}: EntityDocumentProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  // A document that is the page owns the URL, so its rail may link to a section.
  const documentContents = useDocumentContents(rootRef, value ?? '', { reflectHash: true });
  const hasContents = contents && documentContents.headings.length >= 2;

  return (
    // `flex-1 flex flex-col` on this chain down to the visible box below is a no-op unless a
    // caller's own wrapper happens to be a flex column with real spare height to give up (e.g. a
    // tab where this document is the whole page, so its section carries `min-h-full`) — nothing
    // here needs to know that context exists. A host with more content stacked below the body
    // (a project's milestones, an initiative's updates) never has spare height to distribute in
    // the first place, so this is inert for them: the body still sizes to its own text.
    <div
      className={cn(
        'grid min-w-0 flex-1 gap-4',
        hasContents && '@4xl:grid-cols-[minmax(0,calc(75ch+2rem))_11rem]',
      )}
    >
      {/*
       * The body is the first (left) column, so its edge stays flush with the masthead and the
       * sibling sections — the contents live in their own column to the *right*, never indenting
       * the body. Below @4xl the rail collapses into a compact disclosure above the body.
       */}
      <div className="flex min-w-0 flex-col">
        {hasContents ? <DocumentContentsDisclosure contents={documentContents} /> : null}
        <div
          ref={rootRef}
          // `min-h-32` (128px), not `min-h-56` (224px). The floor exists so a click-to-edit body is
          // an obvious target rather than a single bare line, and 128px is four lines of
          // `body-medium` plus the padding — comfortably that. At 224px a one-line description
          // rendered inside an empty box two-thirds of it tall, which reads as a loading state
          // that never resolved; it was the largest empty region on the task detail page.
          className="entity-document bg-surface-container-low flex min-h-32 w-full max-w-[calc(75ch+2rem)] flex-1 flex-col rounded-xl p-4 sm:min-w-[32rem] print:bg-transparent print:p-0"
        >
          <EditableFreeformText
            value={value}
            placeholder={placeholder}
            canEdit={canEdit}
            onSave={onSave}
            {...(onEditStart ? { onEditStart } : {})}
            className="flex min-h-0 max-w-[75ch] flex-1 flex-col"
            contributions={contributions}
          />
        </div>
      </div>
      {hasContents ? (
        <div className="entity-contents-desktop hidden @4xl:block">
          {/* `--detail-header-height` is published by the detail shell's collapse hook. The rail
              and the masthead pin to the same scrollport, and the masthead is opaque and `z-10`;
              a bare `top-4` parked this list 16px into the page and therefore underneath the tab
              bar. Offsetting by the measured header keeps it clear in every collapse state, and
              the fallback leaves it at `top-4` on surfaces that publish nothing. */}
          <div className="sticky top-[calc(var(--detail-header-height,0px)+1rem)] self-start py-4">
            <DocumentContentsRail contents={documentContents} showLabel density="compact" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
