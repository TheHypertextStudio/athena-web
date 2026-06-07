'use client';

/**
 * The provenance ("where did this come from") tag shown on every Triage row.
 *
 * @remarks
 * Incoming work lands in Triage from two kinds of origin, and a triager's first question is
 * always *"where did this come from?"* — so each row leads its trailing metadata with a small
 * token-styled pill encoding the task's {@link TaskProvenance}:
 *
 * - **Native** — created inside Docket. A calm, muted `outline` badge with a {@link Sparkles}
 *   glyph; it carries no external link.
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
import { Layers, Sparkles } from '@docket/ui/icons';
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
 * The small "native vs linked-from-<provider>" provenance pill for a Triage row.
 *
 * @remarks
 * A linked task with an `externalUrl` renders as an anchor (new tab, `rel="noreferrer"`);
 * `onClick`'s `stopPropagation` keeps the row's open-the-task activation from also firing
 * when the upstream link is clicked. Everything else renders as a static badge.
 *
 * @example
 * ```tsx
 * <SourceTag provenance={task.provenance} providerName={providerName} />
 * ```
 */
export function SourceTag({ provenance, providerName }: SourceTagProps): JSX.Element {
  if (provenance.source === 'native') {
    return (
      <Badge variant="outline" className="text-muted-foreground gap-1 font-medium">
        <Sparkles className="h-3 w-3" />
        Native
      </Badge>
    );
  }

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
