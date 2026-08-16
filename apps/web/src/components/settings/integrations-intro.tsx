/**
 * `settings` — the pointer from Connections to Import and back.
 *
 * @remarks
 * This used to lead with a paragraph restating what the section is, directly beneath the section
 * header that had just said it: "Connect tools to keep them in sync with Docket." followed by
 * "Keep Docket and the tools you already work in step with each other." One sentence explaining the
 * page is the header's job, and it already had it.
 *
 * What survived is the part the header cannot carry — that Connections and Import are two different
 * answers to "I use another tool", and the reader may be on the wrong one. Continuous sync and
 * one-time migration must never be bundled into a single surface, so a link between them is how
 * someone who picked wrong gets across.
 */
import { Button } from '@docket/ui/primitives';
import NextLink from 'next/link';
import type { JSX } from 'react';

/** Props for {@link IntegrationsIntro}. */
export interface IntegrationsIntroProps {
  /** Route to the sibling feature (Import ↔ Connections). */
  crossHref: string;
  /** The cross-link's label. */
  crossText: string;
}

/**
 * A link to the sibling surface, for a reader who wanted the other one.
 *
 * @param props - The {@link IntegrationsIntroProps}.
 * @returns the rendered link.
 */
export function IntegrationsIntro({ crossHref, crossText }: IntegrationsIntroProps): JSX.Element {
  return (
    <Button asChild variant="link" controlSize="md" className="w-fit self-start px-0">
      <NextLink href={crossHref}>{crossText}</NextLink>
    </Button>
  );
}
