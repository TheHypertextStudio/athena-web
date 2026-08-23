import { cn } from '@docket/ui';
import { menuFocusRing, menuItemClass, menuLabel, menuSeparator } from '@docket/ui/primitives';

/** Shared row treatment for every choice inside a work-view popover. */
export function workViewPopoverItem(selected = false): string {
  return cn(menuItemClass('standard', { selected }), menuFocusRing, 'w-full');
}

/** Shared section-heading treatment for every work-view popover. */
export const workViewPopoverLabel = menuLabel('standard');

/** Shared section separator for every work-view popover. */
export const workViewPopoverSeparator = menuSeparator('standard');
