'use client';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type FocusEventHandler,
} from 'react';
import { tabIds, type TabsActivation } from '@docket/ui/primitives';
import { restoreShellScroll, shellScrollPosition } from '@/lib/app-location';

/** The four freely revisitable parts of an organization work definition. */
export type TemplateDefinitionSection = 'purpose' | 'work' | 'structure' | 'review';

interface NavigationHandoff {
  section: TemplateDefinitionSection;
  positions: Partial<Record<TemplateDefinitionSection, ReturnType<typeof shellScrollPosition>>>;
  focus: Partial<Record<TemplateDefinitionSection, string>>;
}
const handoffs = new Map<string, NavigationHandoff>();

function fieldLabel(field: HTMLElement): string | undefined {
  const labelled = field as HTMLInputElement;
  return field.getAttribute('aria-label') ?? labelled.labels?.[0]?.textContent.trim();
}

function labelledField(label: string, panel: HTMLElement): HTMLElement | undefined {
  const explicit = Array.from(panel.querySelectorAll<HTMLElement>('[aria-label]')).find(
    (item) => item.getAttribute('aria-label') === label,
  );
  return (
    explicit ??
    Array.from(panel.querySelectorAll('label')).find((item) => item.textContent.trim() === label)
      ?.control ??
    undefined
  );
}

function useRestoreNavigationHandoff(
  handoff: NavigationHandoff | undefined,
  handoffKey: string | undefined,
  focusedFields: RefObject<Partial<Record<TemplateDefinitionSection, HTMLElement>>>,
  scope: string,
): void {
  useLayoutEffect(() => {
    if (!handoff || !handoffKey) return;
    handoffs.delete(handoffKey);
    const frame = requestAnimationFrame(() => {
      for (const [key, label] of Object.entries(handoff.focus)) {
        const panel = document.getElementById(tabIds(scope, key).panelId);
        const field = panel ? labelledField(label, panel) : undefined;
        if (field) focusedFields.current[key as TemplateDefinitionSection] = field;
      }
      focusedFields.current[handoff.section]?.focus({ preventScroll: true });
      const position = handoff.positions[handoff.section];
      if (position) restoreShellScroll(position);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [handoff, handoffKey]);
}

/** Retain section position and input focus using the app's existing main scroll owner. */
export function useTemplateSectionNavigation(
  initial: TemplateDefinitionSection,
  handoffKey?: string,
): {
  scope: string;
  section: TemplateDefinitionSection;
  selectSection: (next: string, source?: TabsActivation) => void;
  rememberFocus: FocusEventHandler<HTMLElement>;
  retainPosition: (key: string) => void;
} {
  const scope = useId();
  const [handoff] = useState(() => (handoffKey ? handoffs.get(handoffKey) : undefined));
  const moveFocus = useRef(true);
  const [section, setSection] = useState<TemplateDefinitionSection>(handoff?.section ?? initial);
  const previous = useRef(section);
  const positions = useRef<
    Partial<Record<TemplateDefinitionSection, ReturnType<typeof shellScrollPosition>>>
  >(handoff?.positions ?? {});
  const focusedFields = useRef<Partial<Record<TemplateDefinitionSection, HTMLElement>>>({});
  const retainPosition = (key: string): void => {
    positions.current[section] = shellScrollPosition();
    const focus: NavigationHandoff['focus'] = {};
    for (const [key, field] of Object.entries(focusedFields.current)) {
      const label = fieldLabel(field);
      if (label) focus[key as TemplateDefinitionSection] = label;
    }
    handoffs.set(key, { section, positions: positions.current, focus });
  };
  useRestoreNavigationHandoff(handoff, handoffKey, focusedFields, scope);
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
  useRestoreSectionFocus({ section, scope, previous, positions, focusedFields, moveFocus });
  return { scope, section, selectSection, rememberFocus, retainPosition };
}

function useRestoreSectionFocus({
  section,
  scope,
  previous,
  positions,
  focusedFields,
  moveFocus,
}: {
  section: TemplateDefinitionSection;
  scope: string;
  previous: RefObject<TemplateDefinitionSection>;
  positions: RefObject<NavigationHandoff['positions']>;
  focusedFields: RefObject<Partial<Record<TemplateDefinitionSection, HTMLElement>>>;
  moveFocus: RefObject<boolean>;
}): void {
  useLayoutEffect(() => {
    if (previous.current === section) return;
    previous.current = section;
    const panel = document.getElementById(tabIds(scope, section).panelId);
    if (!panel) return;
    const position = positions.current[section];
    const remembered = focusedFields.current[section];
    const destination = remembered?.isConnected
      ? remembered
      : panel.querySelector<HTMLElement>('[data-template-section-focus], h2');
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
}
