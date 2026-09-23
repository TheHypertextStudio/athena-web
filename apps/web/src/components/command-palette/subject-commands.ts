'use client';

/**
 * Registry actions the palette offers for what the person was working on when they opened it.
 *
 * @remarks
 * The subject is the selection of the list that held focus when the palette opened, or, with
 * nothing selected, the object whose detail page is on screen. Only actions that declare
 * `palette: true` are listed, and each runs through the action registry with the palette as its
 * source, so the palette and the right-click menu run the same definition.
 */
import { useMemo } from 'react';

import { readSelectionSurfaceFor } from '@/components/selection/selection-registry';
import {
  type ActionContext,
  type ObjectActionScope,
  type ObjectRef,
  describeObject,
  readPageObject,
  useOptionalActionRegistry,
} from '@/lib/actions';
import { useOptionalActionDispatch } from '@/lib/actions/registry-context';

import type { PaletteItem } from './types';

/** What the palette's registry actions operate on. */
export interface PaletteSubject {
  readonly objects: readonly ObjectRef[];
  readonly organizationId: string | null;
  readonly actionScope: ObjectActionScope;
  readonly surfaceId?: string;
  /** Whether the subject is the object whose page is open, rather than a list selection. */
  readonly isPage: boolean;
}

/**
 * Find the palette's subject.
 *
 * @param opener - The element that held focus when the palette opened.
 * @returns the selection or page object, or `null` when there is neither.
 */
export function paletteSubject(opener: Element | null): PaletteSubject | null {
  const selection = readSelectionSurfaceFor(opener);
  if (selection !== null && selection.selectedObjects.length > 0) {
    return {
      objects: selection.selectedObjects,
      organizationId: selection.organizationId,
      actionScope: selection.actionScope,
      surfaceId: selection.surfaceId,
      isPage: false,
    };
  }
  const page = typeof document === 'undefined' ? null : readPageObject();
  if (page === null) return null;
  return { objects: [page], organizationId: page.organizationId, actionScope: 'all', isPage: true };
}

/**
 * The heading for the subject's commands.
 *
 * @param subject - The palette subject.
 * @returns the object's title, or how many objects are selected.
 */
export function paletteSubjectLabel(subject: PaletteSubject): string {
  const [first] = subject.objects;
  if (first === undefined) return '';
  if (subject.objects.length === 1) return first.title;
  const plural = describeObject(first.kind).pluralNoun.toLowerCase();
  return `${String(subject.objects.length)} ${plural} selected`;
}

/** The subject's commands and the heading they are listed under. */
export interface SubjectCommands {
  readonly subject: PaletteSubject | null;
  readonly items: readonly PaletteItem[];
}

const NO_COMMANDS: SubjectCommands = { subject: null, items: [] };

/**
 * One opening of the palette.
 *
 * @remarks
 * A fresh object per opening, so reopening from the same element (the sidebar's search button)
 * still re-reads the subject on the page now on screen.
 */
export interface PaletteOpening {
  /** The element that held focus when the palette opened. */
  readonly element: Element | null;
}

/**
 * List the palette-offered registry actions for the palette's subject.
 *
 * @param opening - The palette's latest opening, or `null` before the first.
 * @param enabled - Whether the palette lists commands right now.
 * @returns the subject and its commands, empty when there is no subject or no registry.
 */
export function useSubjectCommands(
  opening: PaletteOpening | null,
  enabled: boolean,
): SubjectCommands {
  const registry = useOptionalActionRegistry();
  const dispatch = useOptionalActionDispatch();
  return useMemo(() => {
    if (!enabled || opening === null || registry === null || dispatch === null) return NO_COMMANDS;
    const subject = paletteSubject(opening.element);
    if (subject === null) return NO_COMMANDS;
    const resolveContext = (): ActionContext => ({
      objects: subject.objects,
      source: 'command-palette',
      organizationId: subject.organizationId,
      actionScope: subject.actionScope,
      ...(subject.surfaceId === undefined ? {} : { surfaceId: subject.surfaceId }),
    });
    const items = registry
      .resolve(resolveContext)
      .filter((action) => action.definition.palette === true && action.disabledReason === null)
      .map((action): PaletteItem => ({
        id: `subject:${action.id}`,
        section: 'page',
        label: action.label,
        icon: action.icon,
        keywords: action.definition.keywords,
        run: () => {
          // After the palette has closed, so its dismissal cannot close what the action opens.
          window.setTimeout(() => {
            void dispatch(action.id, resolveContext);
          }, 0);
        },
      }));
    return { subject, items };
  }, [dispatch, enabled, opening, registry]);
}
