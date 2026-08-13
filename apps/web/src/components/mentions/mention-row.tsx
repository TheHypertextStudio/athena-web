'use client';

/**
 * One row of the `@` menu.
 *
 * @remarks
 * Reuses the command palette's row grammar verbatim — the same class string, the same trailing
 * pill and kind tag, the same `SEARCH_KIND_ICON` glyphs — so a Project is the same mark in the
 * palette, the search page, and this menu. That consistency is most of what will make the feature
 * feel native rather than bolted on.
 *
 * Every row is a single line at the same height. A Drive file has more to say than fits, and it is
 * tempting to give it a second line, but mixing row heights destroys the arrow-key rhythm that
 * makes a menu feel fast. Extra context goes in the trailing hint; completeness belongs to the
 * hovercard.
 */
import { menuBadge, menuItemClass, menuSupporting } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
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
    <li
      id={id}
      role="option"
      aria-selected={active}
      // Selecting on pointerdown rather than click keeps the editor selection intact: a click
      // would first move focus and collapse the range the insert transaction needs.
      onPointerDown={(event) => {
        event.preventDefault();
        onSelect(item);
      }}
      className={cn(
        // Same row as every other menu in the product.
        menuItemClass('standard'),
        'cursor-pointer',
        // The list is driven by `aria-activedescendant`, not focus, so the active row applies the
        // spec's focus state layer directly.
        { 'bg-on-surface/10': active },
      )}
    >
      <Icon className="shrink-0" />
      <span className="min-w-0 flex-[3] truncate">{item.title}</span>
      {item.subtitle ? (
        // Given a third of the leftover space at most, so a long parent name can never squeeze the
        // title down to an ellipsis — the title is what the reader is aiming at.
        <span
          className={cn(menuSupporting('standard'), 'hidden min-w-0 flex-1 truncate sm:inline')}
        >
          {item.subtitle}
        </span>
      ) : null}
      <span className={cn(menuBadge('standard'), 'bg-surface-container ml-0')}>
        {item.origin === 'external' ? MENTION_PROVIDER_LABEL[item.provider] : kindLabel}
      </span>
      {active ? <CornerDownLeft className="text-on-surface-variant shrink-0" aria-hidden /> : null}
    </li>
  );
}
