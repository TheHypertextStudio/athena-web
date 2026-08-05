'use client';

/**
 * The rich preview a chip shows on hover.
 *
 * @remarks
 * The card never opens empty. Title, kind, and provider are stored on the node itself, so it has
 * real content at zero milliseconds and only the *enrichment* — owner, modified date, snippet,
 * thumbnail — arrives from the network. Those rows reserve their space up front, so the card never
 * resizes under the cursor.
 *
 * Every row collapses entirely when its data is absent. There is no "Unknown owner" and no em
 * dash: a thin resource shows a mark, a title, a source, and a way to open it, and that is a
 * complete card rather than a broken one.
 *
 * `openDelay` is `--dur-base`, long enough that sweeping a cursor across a paragraph of mentions
 * does not strobe; `closeDelay` is `--dur-fast`, since Radix's pointer bridge already covers the
 * trip from chip to card.
 */
import {
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Skeleton,
} from '@docket/ui/primitives';
import { OpenInNew } from '@docket/ui/icons';
import type { MentionCard, MentionRef } from '@docket/types';

import { SEARCH_KIND_ICON, SEARCH_KIND_LABEL } from '@/components/command-palette/use-hub-search';

import { MENTION_PROVIDER_LABEL, RESOURCE_TYPE_ICON, RESOURCE_TYPE_LABEL } from './mention-glyphs';

/** Props for {@link MentionHoverCard}. */
export interface MentionHoverCardProps {
  readonly refValue: MentionRef;
  readonly card: MentionCard | undefined;
  readonly fallbackLabel: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: React.ReactNode;
}

/** Format an ISO timestamp as a short, human date. */
function shortDate(iso: string | null): string | undefined {
  if (iso === null) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Wrap a chip in its preview card.
 *
 * @returns The hover card.
 */
export default function MentionHoverCard({
  refValue,
  card,
  fallbackLabel,
  open,
  onOpenChange,
  children,
}: MentionHoverCardProps): React.JSX.Element {
  const external = card?.kind === 'external' ? card.resource : undefined;
  const entity = card?.kind === 'entity' ? card : undefined;
  // A Docket entity gets the same mark it wears in the palette and the search page; only an
  // external resource is typed by its file kind.
  const Glyph =
    entity === undefined
      ? RESOURCE_TYPE_ICON[external?.resourceType ?? 'unknown']
      : SEARCH_KIND_ICON[entity.entityKind === 'actor' ? 'member' : entity.entityKind];

  const title = entity?.title ?? external?.title ?? fallbackLabel;
  const meta = external
    ? [
        MENTION_PROVIDER_LABEL[external.provider],
        RESOURCE_TYPE_LABEL[external.resourceType],
        external.ownerLabel,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : [
        entity === undefined
          ? undefined
          : SEARCH_KIND_LABEL[entity.entityKind === 'actor' ? 'member' : entity.entityKind],
        entity?.state,
        entity?.ownerLabel,
      ]
        .filter((part): part is string => typeof part === 'string' && part !== '')
        .join(' · ');
  const modified = shortDate(external?.externalUpdatedAt ?? entity?.updatedAt ?? null);
  const href = entity?.href ?? external?.canonicalUrl ?? '';
  const isExternal = refValue.kind === 'external';

  return (
    <HoverCard open={open} onOpenChange={onOpenChange} openDelay={180} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80 overflow-hidden p-0"
      >
        {entity?.accessible === false ? (
          <div className="text-on-surface-variant text-body-medium p-3">
            You do not have access to this item.
          </div>
        ) : (
          <>
            {external?.thumbnailUrl ? (
              <img
                src={external.thumbnailUrl}
                alt=""
                className="border-outline-variant h-32 w-full border-b object-cover"
              />
            ) : null}

            <div className="space-y-1 p-3">
              <div className="flex items-start gap-2">
                <Glyph className="text-on-surface-variant mt-0.5 size-5! shrink-0" aria-hidden />
                <p className="text-title-small line-clamp-2 font-medium">{title}</p>
              </div>

              {meta === '' ? (
                <Skeleton className="h-3 w-40" />
              ) : (
                <p className="text-label-medium text-on-surface-variant">{meta}</p>
              )}

              {(external?.description ?? entity?.subtitle) ? (
                <p className="text-body-medium text-on-surface-variant line-clamp-3">
                  {external?.description ?? entity?.subtitle}
                </p>
              ) : null}
            </div>

            <div className="border-outline-variant flex items-center justify-between border-t px-3 py-2">
              <span className="text-label-medium text-on-surface-variant">
                {modified === undefined ? '' : `Updated ${modified}`}
              </span>
              <Button asChild size="sm" variant="ghost">
                <a
                  href={href}
                  {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  Open
                  {isExternal ? <OpenInNew className="ml-1 size-3.5!" aria-hidden /> : null}
                </a>
              </Button>
            </div>
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
