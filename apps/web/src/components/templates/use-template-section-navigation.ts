'use client';
import { useId, useLayoutEffect, useRef, useState, type FocusEventHandler } from 'react';
import { tabIds, type TabsActivation } from '@docket/ui/primitives';
import { restoreShellScroll, shellScrollPosition } from '@/lib/app-location';

/** The four freely revisitable parts of an organization work definition. */
export type TemplateDefinitionSection = 'purpose' | 'work' | 'structure' | 'review';

/** Retain section position and input focus using the app's existing main scroll owner. */
export function useTemplateSectionNavigation(initial: TemplateDefinitionSection): {
  scope: string;
  section: TemplateDefinitionSection;
  selectSection: (next: string, source?: TabsActivation) => void;
  rememberFocus: FocusEventHandler<HTMLElement>;
} {
  const scope = useId();
  const moveFocus = useRef(true);
  const [section, setSection] = useState<TemplateDefinitionSection>(initial);
  const previous = useRef(section);
  const positions = useRef<
    Partial<Record<TemplateDefinitionSection, ReturnType<typeof shellScrollPosition>>>
  >({});
  const focusedFields = useRef<Partial<Record<TemplateDefinitionSection, HTMLElement>>>({});
  const selectSection = (next: string, source?: TabsActivation): void => {
    if (next !== 'purpose' && next !== 'work' && next !== 'structure' && next !== 'review') return;
    if (next === section) return;
    moveFocus.current = source !== 'keyboard';
    positions.current[section] = shellScrollPosition();
    setSection(next);
  };
  const rememberFocus: FocusEventHandler<HTMLElement> = (event): void => {
    const target = event.target;
    if (target.matches('input, textarea, select, [contenteditable="true"]')) {
      focusedFields.current[section] = target;
    }
  };
  useLayoutEffect(() => {
    if (previous.current === section) return;
    previous.current = section;
    const panel = document.getElementById(tabIds(scope, section).panelId);
    if (!panel) return;
    const position = positions.current[section];
    const remembered = focusedFields.current[section];
    const destination = remembered?.isConnected
      ? remembered
      : panel.querySelector<HTMLElement>('h2');
    if (moveFocus.current) destination?.focus({ preventScroll: true });
    if (position) restoreShellScroll(position);
    else {
      const header = document.querySelector<HTMLElement>('[data-template-definition-header]');
      const stickyHeader = header && getComputedStyle(header).position === 'sticky';
      panel.style.scrollMarginTop = stickyHeader ? `${header.offsetHeight + 24}px` : '';
      // A phone starts each new step with its context; later scrolling belongs to the fields.
      (stickyHeader ? panel : (header ?? panel)).scrollIntoView({ block: 'start' });
    }
  }, [section]);
  return { scope, section, selectSection, rememberFocus };
}
