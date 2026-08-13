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

import {
  SEARCH_KIND_ICON,
  SEARCH_KIND_LABEL,
  searchKindFor,
} from '@/components/command-palette/use-hub-search';

import { ExcerptMarkdown } from './excerpt-markdown';
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
 * The excerpt row: a provider's own description for an external resource, an entity's Markdown
 * excerpt rendered with real (if reduced-fidelity) structure, the entity's flattened `subtitle` as
 * plain text, or nothing at all.
 *
 * @remarks
 * Only `excerptMarkdown` is actually Markdown — it goes through {@link ExcerptMarkdown}. A
 * provider's description and `subtitle` are both already plain text (a `subtitle` reaches here
 * only when an entity has an authored summary but no body to derive `excerptMarkdown` from), so
 * neither one is fed to a Markdown renderer: a plain-text summary that happens to contain a
 * literal `#` or `*` must render as those literal characters, not get lexed as Markdown syntax.
 */
export function excerptRow(
  external: Extract<MentionCard, { kind: 'external' }>['resource'] | undefined,
  entity: Extract<MentionCard, { kind: 'entity' }> | undefined,
): React.ReactNode {
  const excerptClassName = 'text-body-medium text-on-surface-variant line-clamp-3';

  if (external?.description) {
    return <p className={excerptClassName}>{external.description}</p>;
  }
  if (entity?.excerptMarkdown) {
    return <ExcerptMarkdown value={entity.excerptMarkdown} className={excerptClassName} />;
  }
  if (entity?.subtitle) {
    return <p className={excerptClassName}>{entity.subtitle}</p>;
  }
  return null;
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
      : SEARCH_KIND_ICON[searchKindFor(entity.entityKind)];

  const title = entity?.title ?? external?.title ?? fallbackLabel;
  // The kind — "Initiative", "PDF" — reads as a kicker above the title rather than folded into
  // the meta line below it. An entity's kind is known the moment the reference is authored (it's
  // on `refValue`, not the network fetch), so it never needs to wait behind a skeleton; a
  // resource's type is only known once the card resolves, same as everything else external.
  const kicker =
    refValue.kind === 'entity'
      ? SEARCH_KIND_LABEL[searchKindFor(refValue.entityKind)]
      : external
        ? RESOURCE_TYPE_LABEL[external.resourceType]
        : undefined;
  const meta = external
    ? [MENTION_PROVIDER_LABEL[external.provider], external.ownerLabel]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : [entity?.state, entity?.ownerLabel]
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
              {kicker === undefined ? (
                <Skeleton className="h-3 w-16" />
              ) : (
                // No uppercase overline — the product bans that treatment for semantic labels
                // (apps/web/tests/components/initiative-visual-contract.test.ts). Sentence case,
                // set apart from the title only by size/weight/color.
                <p className="text-label-medium text-on-surface-variant font-medium">{kicker}</p>
              )}

              <div className="flex items-start gap-2">
                <Glyph className="text-on-surface-variant mt-0.5 size-5! shrink-0" aria-hidden />
                <p className="text-title-small line-clamp-2 font-medium">{title}</p>
              </div>

              {card === undefined ? (
                // `meta` alone can't tell "still loading" from "loaded, genuinely nothing to
                // show" — state/owner are legitimately absent for plenty of accessible entities.
                // `card` is the real loading signal; once it resolves, an empty `meta` collapses
                // the row instead of leaving a skeleton stuck mid-load forever.
                <Skeleton className="h-3 w-40" />
              ) : meta === '' ? null : (
                <p className="text-label-medium text-on-surface-variant">{meta}</p>
              )}

              {excerptRow(external, entity)}
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
