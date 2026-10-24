import type { JSX } from 'react';
import type { Blueprint } from '@docket/work/work-template-blueprint';

/** Compact authored-child summary alongside a template's root sample or published history. */
export function WorkTemplateBlueprintSummary({ blueprint }: { blueprint: Blueprint }): JSX.Element {
  const optional = blueprint.steps.filter((step) => step.optional.enabled).length;
  const nested = blueprint.steps.filter((step) => step.template !== null).length;
  const details = [
    blueprint.steps.length === 0
      ? 'No included work'
      : `${blueprint.steps.length} included ${blueprint.steps.length === 1 ? 'item' : 'items'}`,
  ];
  if (optional) details.push(`${optional} optional`);
  if (nested) details.push(`${nested} from ${nested === 1 ? 'a template' : 'templates'}`);
  if (blueprint.dependencies.length)
    details.push(
      `${blueprint.dependencies.length} ${blueprint.dependencies.length === 1 ? 'link' : 'links'} between tasks`,
    );
  return (
    <p className="text-body-medium text-on-surface-variant" aria-label="Included work summary">
      {details.join(' · ')}
    </p>
  );
}
