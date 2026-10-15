import type { ReactElement } from 'react';
import { createElement } from 'react';
import { defaultEntityDisplay } from '@docket/work/entity-display-contract';
import type { EntityDisplayGlyph } from '@docket/work/entity-display-contract';
import type { WorkTemplateDisplay } from '@docket/work/work-template-reference';
import {
  formatWorkViewValue,
  workViewRowDisplayValue,
  type WorkViewRowFor,
} from './renderer-types';
import type { ViewTarget } from '@docket/work/view-contract';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';

/** Render an already-authorized template glyph through the shared entity display primitive. */
export function workTemplateGlyph(
  target: ViewTarget,
  icon: EntityDisplayGlyph | null | undefined,
): ReactElement | null {
  return icon
    ? createElement(EntityIconGlyph, {
        subjectType: target,
        glyph: icon,
        colorKey: 'neutral',
        customColor: null,
        size: 20,
      })
    : null;
}

/** Show the pinned publication's compact identity without exposing a draft or identifier. */
export function WorkTemplateLabel({
  target,
  template,
}: {
  readonly target: ViewTarget;
  readonly template: WorkTemplateDisplay | undefined;
}): ReactElement {
  if (!template) return <span>—</span>;
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      title={`${template.name} · Version ${String(template.versionNumber)}`}
    >
      {workTemplateGlyph(target, template.icon)}
      <span className="truncate">{template.name}</span>
    </span>
  );
}

/** Name a template facet with its published glyph using the existing choice text wrapper. */
export function filterChoiceLabel(
  target: ViewTarget,
  option: { readonly label: string; readonly icon?: EntityDisplayGlyph | null | undefined },
): ReactElement {
  return (
    <>
      {workTemplateGlyph(target, option.icon)}
      {option.label}
    </>
  );
}

/** Render a roster/card property through its named projection, with a glyph for templates. */
export function workViewPropertyLabel(
  row: WorkViewRowFor<ViewTarget>,
  field: { readonly key: string; readonly kind: string },
): ReactElement | string {
  return field.key === 'workTypeId' ? (
    <WorkTemplateLabel target={row.target} template={row.workTemplate} />
  ) : (
    formatWorkViewValue(workViewRowDisplayValue(row, field.key), field.kind)
  );
}

/** Keep non-base identity discoverable when the card has no separate Template property. */
export function WorkCardTemplateIdentity({
  row,
  properties,
}: {
  readonly row: WorkViewRowFor<ViewTarget>;
  readonly properties: ReadonlySet<string>;
}): ReactElement | null {
  return row.workTemplate && !row.workTemplate.isBase && !properties.has('workTypeId') ? (
    <WorkTemplateLabel target={row.target} template={row.workTemplate} />
  ) : null;
}

/** Prefer an item's explicit glyph, then its pinned template, then the kind's display default. */
export function workTemplateRowGlyph(row: WorkViewRowFor<ViewTarget>): EntityDisplayGlyph {
  return (
    row.display?.glyph ?? row.workTemplate?.icon ?? defaultEntityDisplay(row.target, row.id).glyph
  );
}
