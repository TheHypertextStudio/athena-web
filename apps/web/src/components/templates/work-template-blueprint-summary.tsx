import type { JSX } from 'react';
import { Badge } from '@docket/ui/primitives';
import type { Blueprint } from '@docket/work/work-template-blueprint';

/** Compact authored-child summary alongside a template's root sample or published history. */
export function WorkTemplateBlueprintSummary({ blueprint }: { blueprint: Blueprint }): JSX.Element {
  const optional = blueprint.steps.filter((step) => step.optional.enabled).length;
  const nested = blueprint.steps.filter((step) => step.template !== null).length;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Blueprint summary">
      <Badge>
        {blueprint.steps.length} {blueprint.steps.length === 1 ? 'child' : 'children'}
      </Badge>
      {optional ? <Badge variant="outline">{optional} optional</Badge> : null}
      {nested ? (
        <Badge variant="outline">
          {nested} nested {nested === 1 ? 'template' : 'templates'}
        </Badge>
      ) : null}
      {blueprint.dependencies.length ? (
        <Badge variant="outline">{blueprint.dependencies.length} dependencies</Badge>
      ) : null}
    </div>
  );
}
