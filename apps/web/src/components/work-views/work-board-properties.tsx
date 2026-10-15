import { WorkTemplateLabel } from './work-template-label';
import type { JSX } from 'react';
import type { ViewTarget } from '@docket/work/view-contract';
import {
  formatWorkViewValue,
  workViewRowDisplayValue,
  type WorkViewRowFor,
} from './renderer-types';

/** Show the selected card properties without changing the card's interaction policy. */
export function WorkBoardProperties({
  row,
  properties,
}: {
  readonly row: WorkViewRowFor<ViewTarget>;
  readonly properties: readonly {
    readonly key: string;
    readonly label: string;
    readonly kind: string;
  }[];
}): JSX.Element | null {
  const visibleProperties =
    row.workTemplate &&
    !row.workTemplate.isBase &&
    !properties.some((field) => field.key === 'workTypeId')
      ? [{ key: 'workTypeId', label: 'Template', kind: 'relation-one' }, ...properties]
      : properties;
  if (visibleProperties.length === 0) return null;
  return (
    <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {visibleProperties.map((field) => (
        <div
          key={field.key}
          className="text-on-surface-variant text-label-small flex min-w-0 gap-1"
        >
          <dt className="sr-only">{field.label}</dt>
          <dd className="max-w-36 truncate">
            {field.key === 'workTypeId' ? (
              <WorkTemplateLabel target={row.target} template={row.workTemplate} />
            ) : (
              formatWorkViewValue(workViewRowDisplayValue(row, field.key), field.kind)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
