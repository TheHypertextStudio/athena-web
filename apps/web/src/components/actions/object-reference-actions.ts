'use client';

/**
 * The read-only actions every task, project, and initiative offers: Copy and Show origin.
 *
 * @remarks
 * Each of the three domains spreads this pair into its own `defineActionDomain` list, so the two
 * definitions stay built once and every domain offers them the same way.
 */
import { copyObjectAction } from '@/components/actions/copy-object-action';
import {
  type OriginNavigator,
  type OriginObjectKind,
  showOriginAction,
} from '@/components/provenance/show-origin-action';

/**
 * Build Copy and Show origin for one kind.
 *
 * @param kind - The kind both actions are offered for.
 * @param reportOutcome - Where Copy reports whether the clipboard took the payload.
 * @param navigator - The app router, for Show origin invoked away from the object's page.
 * @returns the two definitions, to spread into that kind's domain.
 */
export function objectReferenceActions(
  kind: OriginObjectKind,
  reportOutcome: (wrote: boolean) => void,
  navigator: OriginNavigator,
) {
  return [copyObjectAction(kind, reportOutcome), showOriginAction(kind, navigator)] as const;
}
