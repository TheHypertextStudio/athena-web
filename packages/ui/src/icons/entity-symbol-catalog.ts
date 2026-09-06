import type { MaterialSymbolName } from '@docket/work/entity-display-contract';
import { MATERIAL_SYMBOL_NAMES } from '@docket/work/material-symbol-catalog';

/** Search metadata for one Material Symbol in stable catalog order. */
export interface EntitySymbolOption {
  readonly name: MaterialSymbolName;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly order: number;
}

const SYMBOL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  account_tree: ['workflow', 'process', 'initiative'],
  apartment: ['building', 'office', 'organization'],
  auto_awesome: ['sparkles', 'creative'],
  badge: ['label', 'identity'],
  content_paste: ['clipboard', 'task'],
  directions_bus: ['bus', 'transit', 'transportation'],
  directions_railway: ['train', 'transit', 'rail'],
  diversity_3: ['community', 'coalition'],
  emoji_people: ['pedestrian', 'walking', 'street'],
  flag: ['milestone', 'priority'],
  folder_open: ['folder', 'project'],
  groups: ['people', 'team', 'community'],
  hub: ['network', 'initiative'],
  layers: ['portfolio', 'program', 'stack'],
  map: ['place', 'region', 'transit'],
  outlined_flag: ['milestone', 'flag'],
  public: ['globe', 'regional'],
  rocket_launch: ['launch', 'release'],
  route: ['path', 'transit', 'roadmap'],
  subway: ['metro', 'transit', 'rail'],
  timeline: ['cycle', 'plan', 'roadmap'],
  track_changes: ['target', 'goal', 'objective', 'okr', 'initiative'],
  train: ['rail', 'transit', 'transportation'],
};

/** Convert a ligature such as `account_balance` into `Account balance`. */
export function materialSymbolLabel(name: string): string {
  const words = name.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Every pinned symbol with a readable label and Docket-specific search aliases. */
export const ENTITY_SYMBOL_OPTIONS: readonly EntitySymbolOption[] = MATERIAL_SYMBOL_NAMES.map(
  (name, order) => ({
    name,
    label: materialSymbolLabel(name),
    keywords: SYMBOL_ALIASES[name] ?? [],
    order,
  }),
);
