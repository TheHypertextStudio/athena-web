import NextLink from 'next/link';
import type { JSX } from 'react';

/** Props for {@link IntegrationsIntro}. */
export interface IntegrationsIntroProps {
  /** The feature's one-line explanation of what connecting/importing does. */
  text: string;
  /** Route to the sibling feature (Import ↔ Connections). */
  crossHref: string;
  /** The cross-link's label. */
  crossText: string;
}

/** The intro block shared by Connections and Import: a one-line explanation plus a sibling link. */
export function IntegrationsIntro({
  text,
  crossHref,
  crossText,
}: IntegrationsIntroProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-on-surface-variant text-body-medium leading-relaxed">{text}</p>
      <NextLink
        href={crossHref}
        className="text-primary text-body-medium w-fit font-medium hover:underline"
      >
        {crossText}
      </NextLink>
    </div>
  );
}
