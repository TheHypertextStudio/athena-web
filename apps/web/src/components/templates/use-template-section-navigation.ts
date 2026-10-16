'use client';
import { useLayoutEffect, useRef, useState, type FocusEventHandler } from 'react';
import { useInputModality } from '@docket/ui/hooks';
import { restoreShellScroll, shellScrollPosition } from '@/lib/app-location';

/** The four freely revisitable parts of an organization work definition. */
export type TemplateDefinitionSection = 'purpose' | 'work' | 'structure' | 'review';

/** Retain section position and input focus using the app's existing main scroll owner. */
export function useTemplateSectionNavigation(initial: TemplateDefinitionSection): {
  section: TemplateDefinitionSection;
  selectSection: (next: string) => void;
  rememberFocus: FocusEventHandler<HTMLElement>;
} {
  const modality = useInputModality();
  const moveFocus = useRef(true);
  const [section, setSection] = useState<TemplateDefinitionSection>(initial);
  const previous = useRef(section);
  const positions = useRef<
    Partial<Record<TemplateDefinitionSection, ReturnType<typeof shellScrollPosition>>>
  >({});
  const focusedFields = useRef<Partial<Record<TemplateDefinitionSection, HTMLElement>>>({});
  const selectSection = (next: string): void => {
    if (next !== 'purpose' && next !== 'work' && next !== 'structure' && next !== 'review') return;
    if (next === section) return;
    moveFocus.current = !(
      modality === 'keyboard' && document.activeElement?.getAttribute('role') === 'tab'
    );
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
    const panel = document.getElementById(`tabpanel-${section}`);
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
      if (header) panel.style.scrollMarginTop = `${header.offsetHeight + 24}px`;
      panel.scrollIntoView({ block: 'start' });
    }
  }, [section]);
  return { section, selectSection, rememberFocus };
}
