'use client';

/**
 * Render a mention node inside the editor, with its hovercard.
 *
 * @remarks
 * The hovercard is *controlled* rather than left to Radix's own hover handling, because in an
 * editable surface the chip is not a tab stop — making it one would let Tab walk out of the
 * document. Selecting the node is the keyboard path instead: arrowing onto an atom selects it,
 * that selection feeds `open`, and the card appears. So the preview stays reachable without a
 * mouse and without breaking the editor's own keyboard model.
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';

import { SEARCH_KIND_ICON } from '@/components/command-palette/use-hub-search';

import MentionChip from './mention-chip';
import { RESOURCE_TYPE_ICON } from './mention-glyphs';
import MentionHoverCard from './mention-hovercard';
import { readMentionAttributes, refFromAttributes } from './mention-extension';
import { useMentionCard, useRegisterMention } from './mention-hydration';

/**
 * The React node view for a mention.
 *
 * @returns The chip, wrapped for ProseMirror.
 */
export default function MentionNodeView({ node, selected }: NodeViewProps): React.JSX.Element {
  const attrs = readMentionAttributes(node.attrs);
  const ref = refFromAttributes(attrs);
  const register = useRegisterMention();
  const { card } = useMentionCard(ref);
  const [hovered, setHovered] = useState(false);

  // Keyed on the node's own attributes rather than on `ref`, which is a fresh object each render:
  // re-registering every render would churn the batch key and refetch the whole surface.
  useEffect(() => {
    register(refFromAttributes(attrs));
  }, [register, attrs]);

  // The freshest title wins, but the authored label is always there to fall back on, so a chip
  // never renders blank while its preview loads or after access to the target is lost.
  const resolvedLabel =
    card?.kind === 'entity' ? (card.title ?? attrs.label) : (card?.resource.title ?? attrs.label);
  const unresolved = card?.kind === 'entity' && !card.accessible;

  // The same mark the row wore in the picker, so a chip is recognizable as the thing that was
  // chosen rather than as generic link text.
  const Glyph =
    ref.kind === 'entity'
      ? SEARCH_KIND_ICON[ref.entityKind === 'actor' ? 'member' : ref.entityKind]
      : RESOURCE_TYPE_ICON[card?.kind === 'external' ? card.resource.resourceType : 'unknown'];

  return (
    <NodeViewWrapper as="span" className="inline">
      <MentionHoverCard
        refValue={ref}
        card={card}
        fallbackLabel={attrs.label}
        open={hovered || selected}
        onOpenChange={setHovered}
      >
        <span
          onPointerEnter={() => {
            setHovered(true);
          }}
          onPointerLeave={() => {
            setHovered(false);
          }}
        >
          <MentionChip
            ref={ref}
            label={resolvedLabel}
            href={attrs.href}
            editable
            selected={selected}
            unresolved={unresolved}
            external={ref.kind === 'external'}
            icon={<Glyph className="size-[0.9em]!" />}
          />
        </span>
      </MentionHoverCard>
    </NodeViewWrapper>
  );
}
