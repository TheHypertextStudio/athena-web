import type { JSX } from 'react';
import type { Blueprint } from '@docket/work/work-template-blueprint';

/** Compact authored-child summary alongside a template's root sample or published history. */
export function WorkTemplateBlueprintSummary({ blueprint }: { blueprint: Blueprint }): JSX.Element {
  const optional = blueprint.steps.filter((step) => step.optional.enabled).length;
  const nested = blueprint.steps.filter((step) => step.template !== null).length;
  const details = [
    `${blueprint.steps.length} ${blueprint.steps.length === 1 ? 'child' : 'children'}`,
  ];
  if (optional) details.push(`${optional} optional`);
  if (nested) details.push(`${nested} nested ${nested === 1 ? 'template' : 'templates'}`);
  if (blueprint.dependencies.length) details.push(`${blueprint.dependencies.length} dependencies`);
  return (
    <p className="text-body-small text-on-surface-variant" aria-label="Blueprint summary">
      {details.join(' · ')}
    </p>
  );
}
