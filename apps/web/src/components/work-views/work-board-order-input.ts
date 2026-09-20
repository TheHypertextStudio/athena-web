import type { ViewTarget } from '@docket/work/view-contract';
import { isMutableWorkViewGroupPath, type WorkViewGroupSummary } from './renderer-types';
import type { WorkBoardDrop } from './work-board';
import { isRouteOwnedDirectWorkViewRow } from './work-view-object';
import type { WorkViewOrderInput } from './use-work-view-order';

/** Build an order write only for editable rows and native group values. */
export function workBoardOrderInput<TTarget extends ViewTarget>(
  drop: WorkBoardDrop<TTarget>,
  context: {
    readonly target: TTarget;
    readonly organizationId: string;
    readonly canContribute: boolean;
    readonly groupField: string | null;
    readonly groups: readonly WorkViewGroupSummary[];
  },
): WorkViewOrderInput | null {
  if (
    !context.canContribute ||
    !isRouteOwnedDirectWorkViewRow(drop.item, context.organizationId) ||
    !isMutableWorkViewGroupPath(context.groups, drop.sourcePath) ||
    !isMutableWorkViewGroupPath(context.groups, drop.destinationPath)
  )
    return null;
  return {
    target: context.target,
    organizationId: context.organizationId,
    itemId: drop.item.id,
    groupField: context.groupField,
    sourceGroupValue: nativeGroupValue(drop.sourcePath),
    groupValue: nativeGroupValue(drop.destinationPath),
    beforeId: drop.beforeId,
    afterId: drop.afterId,
  };
}

function nativeGroupValue(path: readonly string[]): string | null {
  const value = path[0] ?? null;
  return value === '__empty__' ? null : value;
}
