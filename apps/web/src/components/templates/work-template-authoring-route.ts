import type { TemplateDefinitionSection } from './use-template-section-navigation';
import { workTemplateHref } from './work-template-navigation';

/** Presentation mode never enters the saved definition contract. */
export type TemplateAuthoringMode = 'create' | 'edit';

/** Preserve authoring intent and validated parent identity through first-save route replacement. */
export function templateAuthoringHref(
  orgId: string,
  id: string,
  section: TemplateDefinitionSection,
  mode: TemplateAuthoringMode,
  context: URLSearchParams,
): string {
  const params = new URLSearchParams(context);
  params.set('section', section);
  if (mode === 'create') params.set('mode', mode);
  else params.delete('mode');
  return `${workTemplateHref(orgId)}/${id}?${params.toString()}`;
}
