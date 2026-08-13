'use client';

/**
 * The references an entity's own prose points at, shown alongside what someone attached by hand.
 *
 * @remarks
 * Derived rows sit one tonal step quieter than the curated list, so "we worked this out from your
 * writing" is legible without a label having to say it. They carry no remove control: the way to
 * remove one is to delete it from the prose, and offering a button that silently does nothing to
 * the text would be a lie.
 */
import { RESOURCE_PROVIDER_LABEL, type EntityMention } from '@docket/types';
import type { JSX } from 'react';

import {
  SEARCH_KIND_ICON,
  SEARCH_KIND_LABEL,
  searchKindFor,
} from '@/components/command-palette/use-hub-search';
import { RESOURCE_TYPE_ICON, RESOURCE_TYPE_LABEL } from '@/components/mentions/mention-glyphs';

/** Props for {@link MentionedResources}. */
export interface MentionedResourcesProps {
  /** The section heading. */
  readonly heading: string;
  /** The references to list, already filtered to what the reader may see. */
  readonly mentions: readonly EntityMention[];
  /** True while the read is in flight, which only reserves space when there is prose to read. */
  readonly pending: boolean;
  /** Whether the entity has any prose at all; false suppresses the loading state entirely. */
  readonly hasProse: boolean;
}

/** Turn the fields a reference appears in into a provenance line. */
function provenance(mention: EntityMention): string {
  const where = mention.fields
    .map((field) => (field === 'body' ? 'the update' : field))
    .join(' and ');
  return mention.occurrences > 1 ? `${mention.occurrences}× in ${where}` : `in ${where}`;
}

/**
 * Render one derived section of the Resources tab.
 *
 * @returns The section, or an empty fragment when there is nothing to show.
 */
export default function MentionedResources({
  heading,
  mentions,
  pending,
  hasProse,
}: MentionedResourcesProps): JSX.Element | null {
  // A skeleton for a section that is certainly empty is worse than no section at all.
  if (mentions.length === 0 && (!pending || !hasProse)) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-on-surface-variant text-label-medium px-1">{heading}</h3>
      {mentions.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-xl p-2">
          <div className="h-14 animate-pulse rounded-lg" aria-hidden />
        </div>
      ) : (
        <ul className="bg-surface-container-lowest rounded-xl p-2">
          {mentions.map((mention) => {
            const external = mention.resource;
            const Glyph =
              mention.ref.kind === 'entity'
                ? SEARCH_KIND_ICON[searchKindFor(mention.ref.entityKind)]
                : RESOURCE_TYPE_ICON[external?.resourceType ?? 'unknown'];
            const kindLabel =
              mention.ref.kind === 'entity'
                ? SEARCH_KIND_LABEL[searchKindFor(mention.ref.entityKind)]
                : `${RESOURCE_PROVIDER_LABEL[external?.provider ?? 'web']} · ${RESOURCE_TYPE_LABEL[external?.resourceType ?? 'unknown']}`;
            const isExternal = mention.ref.kind === 'external';

            return (
              <li key={mention.key}>
                <a
                  href={mention.href}
                  {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="hover:bg-surface-container focus-visible:bg-surface-container flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
                >
                  <span className="bg-surface-container text-on-surface-variant flex size-8 shrink-0 items-center justify-center rounded-full">
                    <Glyph aria-hidden className="size-4!" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-on-surface truncate text-sm font-medium">
                      {external?.title ?? mention.label}
                    </span>
                    <span className="text-on-surface-variant truncate text-xs">{kindLabel}</span>
                  </span>
                  <span className="text-on-surface-variant hidden shrink-0 text-xs sm:inline">
                    {provenance(mention)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
