'use client';

/**
 * `views` — the sharing-scope badge for a saved view.
 *
 * @remarks
 * A saved view is shareable, but at one of three scopes (mvp-plan §8.3d): `personal` (only the
 * owner sees it), `team` (everyone on the owning team), or `organization` (the whole org). The
 * badge encodes that scope with a leading glyph + plain-language label so the reach of a view is
 * legible at a glance in the list. Sharing never widens *access* — the API still
 * permission-scopes the rows a viewer receives — so the badge describes *visibility of the view
 * definition*, not the data it can surface. All color comes from semantic tokens via the
 * {@link Badge} variant.
 */
import type { ViewScope } from '@docket/types';
import { type LucideIcon, LayoutGrid, User, Users } from '@docket/ui/icons';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** The per-scope glyph, label, and badge variant. */
const SCOPE_META: Record<
  ViewScope,
  { label: string; description: string; Icon: LucideIcon; variant: 'secondary' | 'outline' }
> = {
  personal: {
    label: 'Personal',
    description: 'Only you can see this view',
    Icon: User,
    variant: 'outline',
  },
  team: {
    label: 'Team',
    description: 'Shared with your team',
    Icon: Users,
    variant: 'secondary',
  },
  organization: {
    label: 'Organization',
    description: 'Shared with the whole organization',
    Icon: LayoutGrid,
    variant: 'secondary',
  },
};

/** Props for {@link ViewScopeBadge}. */
export interface ViewScopeBadgeProps {
  /** The view's sharing scope. */
  scope: ViewScope;
}

/**
 * A small badge labelling a saved view's sharing scope.
 *
 * @param props - The {@link ViewScopeBadgeProps}.
 * @returns the rendered scope badge.
 */
export function ViewScopeBadge({ scope }: ViewScopeBadgeProps): JSX.Element {
  const meta = SCOPE_META[scope];
  const Icon = meta.Icon;
  return (
    <Badge variant={meta.variant} className="gap-1 font-normal" title={meta.description}>
      <Icon aria-hidden="true" className="size-3" />
      {meta.label}
    </Badge>
  );
}
