'use client';

/**
 * One row of the `@` menu.
 *
 * @remarks
 * Reuses the command palette's row grammar, trailing pill, kind tag, and `SEARCH_KIND_ICON`
 * glyphs. The mention picker narrows that shared row from 44px to 40px because autocomplete stays
 * attached to a line of prose and needs a denser scan rhythm than a standalone command menu.
 *
 * Every row is a single line at the same height. A Drive file has more to say than fits, and it is
 * tempting to give it a second line, but mixing row heights destroys the arrow-key rhythm that
 * makes a menu feel fast. Extra context goes in the trailing hint; completeness belongs to the
 * hovercard.
 */
import { MenuOption } from '@docket/ui/components';
import { Badge } from '@docket/ui/primitives';
import type { MentionItem } from '@docket/types';
import { CornerDownLeft } from '@docket/ui/icons';

import {
  SEARCH_KIND_ICON,
  SEARCH_KIND_LABEL,
  searchKindFor,
} from '@/components/command-palette/use-hub-search';

import { MENTION_PROVIDER_LABEL, RESOURCE_TYPE_ICON, RESOURCE_TYPE_LABEL } from './mention-glyphs';

/** Props for {@link MentionRow}. */
export interface MentionRowProps {
  readonly item: MentionItem;
  readonly active: boolean;
  readonly id: string;
  readonly onSelect: (item: MentionItem) => void;
}

/**
 * Render one selectable mention row.
 *
 * @returns The row element.
 */
export default function MentionRow({
  item,
  active,
  id,
  onSelect,
}: MentionRowProps): React.JSX.Element {
  const Icon =
    item.origin === 'local'
      ? SEARCH_KIND_ICON[searchKindFor(item.entityKind)]
      : RESOURCE_TYPE_ICON[item.resourceType];
  const kindLabel =
    item.origin === 'local'
      ? SEARCH_KIND_LABEL[searchKindFor(item.entityKind)]
      : RESOURCE_TYPE_LABEL[item.resourceType];

  return (
    <MenuOption
      id={id}
      active={active}
      leading={<Icon aria-hidden />}
      secondary={item.subtitle}
      badge={
        <Badge variant="secondary">
          {item.origin === 'external' ? MENTION_PROVIDER_LABEL[item.provider] : kindLabel}
        </Badge>
      }
      trailing={active ? <CornerDownLeft className="text-on-surface-variant" aria-hidden /> : null}
      onSelect={() => {
        onSelect(item);
      }}
      className={cn(
        // Keep the shared menu grammar, with the mention picker's denser 40px row contract.
        menuItemClass('standard'),
        'min-h-10 cursor-pointer',
        // The list is driven by `aria-activedescendant`, not focus, so the active row applies the
        // spec's focus state layer directly.
        { 'bg-on-surface/10': active },
      )}
    >
      {item.title}
    </MenuOption>
  );
}
