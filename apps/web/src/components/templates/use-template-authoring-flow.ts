'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { WorkTemplateFormState } from './use-work-template-form';
import type { WorkTemplateFormProps } from './work-template-form';
import {
  takeTemplateEditorSelection,
  retainTemplateEditorSelection,
  clearTemplateEditorSelection,
} from './template-editor-selection';
import { useTemplateSectionNavigation } from './use-template-section-navigation';
import { useWorkTemplateForm } from './use-work-template-form';
import { TEMPLATE_SECTIONS } from './template-definition-navigation';
import { templateSectionError } from './template-definition-action';
import { useTemplatePublicationReadiness } from './work-template-publication-readiness';

/** Presentation state and actions shared by the authoring sections and persistent footer. */
export interface TemplateAuthoringFlow {
  form: WorkTemplateFormState;
  selection: Map<string, string | null>;
  navigation: ReturnType<typeof useTemplateSectionNavigation>;
  mode: 'create' | 'edit';
  reached: number;
  validation: string | null;
  validationRef: RefObject<HTMLDivElement | null>;
  publicationBlocked: boolean;
  back: () => void;
  next: () => void;
  context: string;
}

/** Keep guided progress in presentation state while persistence uses the existing draft contract. */
export function useTemplateAuthoringFlow(props: WorkTemplateFormProps): TemplateAuthoringFlow {
  const { initial, orgId, initialSection, onCreated, onFinish } = props;
  const mode = authoringMode(props);
  const [selection] = useState(() =>
    takeTemplateEditorSelection(initial ? `${orgId}/${initial.id}` : undefined),
  );
  useEffect(() => {
    if (initial) clearTemplateEditorSelection(`${orgId}/${initial.id}`);
  }, [orgId, initial]);
  const navigation = useTemplateSectionNavigation(
    initialSection ?? (mode === 'edit' ? 'work' : 'purpose'),
    initial ? `${orgId}/${initial.id}` : undefined,
  );
  const start = props.initialReached ?? 0;
  const [reached, setReached] = useState(
    Math.max(
      Math.min(Number.isFinite(start) ? start : 0, 3),
      TEMPLATE_SECTIONS.findIndex((item) => item.value === navigation.section),
    ),
  );
  const validationRef = useRef<HTMLDivElement>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const form = useWorkTemplateForm(
    orgId,
    initial,
    (createdId, created) => {
      navigation.retainPosition(`${orgId}/${createdId}`);
      retainTemplateEditorSelection(`${orgId}/${createdId}`, selection);
      onCreated(createdId, navigation.section, created, reached);
    },
    mode === 'create' ? onFinish : undefined,
  );
  const readiness = useTemplatePublicationReadiness(orgId, form.definition);
  const publicationBlocked = readiness.loading || readiness.failed || readiness.pending.length > 0;
  function back(): void {
    const index = TEMPLATE_SECTIONS.findIndex((item) => item.value === navigation.section);
    const previous = TEMPLATE_SECTIONS[index - 1];
    if (previous) navigation.selectSection(previous.value);
    else onFinish?.();
  }
  function next(): void {
    const error = templateSectionError(form, navigation.section);
    setValidation(error);
    if (error) {
      requestAnimationFrame(() => {
        validationRef.current?.focus({ preventScroll: true });
        validationRef.current?.scrollIntoView({ block: 'start' });
      });
      return;
    }
    const index = TEMPLATE_SECTIONS.findIndex((item) => item.value === navigation.section) + 1;
    const destination = TEMPLATE_SECTIONS[index];
    if (destination) {
      setReached(Math.max(reached, index));
      navigation.selectSection(destination.value);
    }
  }
  const context = new URLSearchParams(props.returnContext);
  if (mode === 'create') {
    context.set('mode', 'create');
    context.set('reached', String(reached));
  }
  return {
    form,
    selection,
    navigation,
    mode,
    reached,
    validation,
    validationRef,
    publicationBlocked,
    back,
    next,
    context: context.toString(),
  };
}

function authoringMode(props: WorkTemplateFormProps): 'create' | 'edit' {
  if (props.initial?.canEdit === false || props.initial?.status === 'archived') return 'edit';
  return props.mode ?? (props.initial ? 'edit' : 'create');
}
