'use client';

/**
 * The provenance ("where did this come from") tag shown on every Triage row.
 *
 * @remarks
 * Incoming work lands in Triage from two kinds of origin, and a triager's first question is
 * always *"where did this come from?"* — but only one of the two answers is worth a pill:
 *
 * - **Created in Docket** — no tag at all. This is the default and the overwhelming majority, so a
 *   badge on every such row costs a column of visual noise to state the unremarkable. It also read
 *   as the word "Native", which describes the implementation rather than anything a reader can act
 *   on: a triage row measured as *"Drag Me Today Native LE"*. Absence is the clearer signal — a row
 *   with no origin pill was made here.
 * - **Linked** — mirrored or imported from an external tool (GitHub, Linear, …) via an
 *   integration. A `secondary` badge naming the provider (resolved to its friendly label),
 *   with a {@link Layers} glyph (an external, upstream source). When the source carries an
 *   `externalUrl`, the pill renders as an anchor that opens the upstream item in a new tab
 *   (so a triager can check the original before sorting), and the row's own click-to-open is
 *   not hijacked.
 *
 * Colors come exclusively from semantic tokens via the {@link Badge} variants — never
 * hardcoded.
 */
import type { TaskProvenance } from '@docket/types';
import { Layers } from '@docket/ui/icons';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for {@link SourceTag}. */
export interface SourceTagProps {
  /** The task's provenance triple (native vs linked, plus the external link when present). */
  provenance: TaskProvenance;
  /**
   * Resolve a stored integration `provider` slug (e.g. `github`) to its friendly display
   * name (e.g. `GitHub`). Falls back to the raw slug inside the resolver when unknown.
   */
  providerName: (provider: string | null | undefined) => string;
}

/**
 * The "linked-from-<provider>" provenance pill for a Triage row, or nothing at all.
 *
 * @remarks
 * Returns `null` for a task created in Docket: there is no origin to name, and a pill saying so
 * would appear on nearly every row while telling the reader nothing. A linked task with an
 * `externalUrl` renders as an anchor (new tab, `rel="noreferrer"`); `onClick`'s `stopPropagation`
 * keeps the row's open-the-task activation from also firing when the upstream link is clicked.
 * Everything else renders as a static badge.
 *
 * @example
 * ```tsx
 * <SourceTag provenance={task.provenance} providerName={providerName} />
 * ```
 */
export function SourceTag({ provenance, providerName }: SourceTagProps): JSX.Element | null {
  if (provenance.source === 'native') return null;

  const name = providerName(provenance.sourceIntegrationId ?? null);
  const label = `Linked · ${name}`;

  if (provenance.externalUrl) {
    return (
      <a
        href={provenance.externalUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-1"
        title={`Open the original in ${name}`}
      >
        <Badge variant="secondary" className="gap-1 font-medium hover:underline">
          <Layers className="h-3 w-3" />
          {label}
        </Badge>
      </a>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1 font-medium">
      <Layers className="h-3 w-3" />
      {label}
    </Badge>
  );
}
