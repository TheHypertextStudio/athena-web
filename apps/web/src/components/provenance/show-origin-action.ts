'use client';

/**
 * The Show origin action, defined once for tasks, projects, and initiatives.
 *
 * @remarks
 * Opens the origin card on the object's Created row. Invoked on the object's own page, it opens
 * the card there; invoked from a list or another page, it navigates to the object first and the
 * Created row opens the card when the page mounts. Both paths go through the origin request store
 * (`lib/provenance/origin-request.ts`). One object at a time: the registry does not offer it for a
 * multi-object selection.
 */
import { History } from '@docket/ui/icons';

import {
  type ActionContext,
  type ActionDefinitionInput,
  type ObjectRef,
  objectHref,
} from '@/lib/actions';
import { requestOrigin } from '@/lib/provenance/origin-request';

/** The kinds whose pages carry a Created row. */
export type OriginObjectKind = 'task' | 'project' | 'initiative';

/** What the action needs to move to another page. */
export interface OriginNavigator {
  readonly push: (href: string) => void;
}

/**
 * Whether a path is the object's page or one of its tabs.
 *
 * @param href - The object's page path.
 * @param pathname - The current path.
 * @returns true when the object's page is on screen.
 */
export function isObjectPage(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Open an object's origin card, navigating to its page first when it is not on screen.
 *
 * @param object - The task, project, or initiative.
 * @param navigator - The app router.
 */
export function showOrigin(object: ObjectRef, navigator: OriginNavigator): void {
  requestOrigin(object);
  const href = objectHref(object);
  if (href === null || isObjectPage(href, window.location.pathname)) return;
  navigator.push(href);
}

/**
 * Build the Show origin action for one kind.
 *
 * The return type is inferred, as with `copyObjectAction`, so `defineActionDomain` can validate
 * the implementation's return type.
 *
 * @param kind - The kind this action is offered for.
 * @param navigator - The app router.
 * @returns the definition to include in that kind's domain.
 */
export function showOriginAction(kind: OriginObjectKind, navigator: OriginNavigator) {
  return {
    id: `${kind}.showOrigin`,
    label: 'Show origin',
    icon: History,
    objectKinds: [kind],
    section: 'primary',
    palette: true,
    keywords: ['origin', 'provenance', 'created by', 'source', 'history'],
    run: (context: ActionContext) => {
      const object = context.objects[0];
      if (object !== undefined) showOrigin(object, navigator);
    },
  } satisfies ActionDefinitionInput;
}
