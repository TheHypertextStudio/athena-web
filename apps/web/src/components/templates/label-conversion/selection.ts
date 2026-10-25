import { WorkViewQueryRequest } from '@docket/work/work-view-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { LabelTemplateConversionChoices } from '@docket/work/work-template-contract';

/** The published source fixes the kind and identity; label selection never applies starting fields. */
export interface ConversionSelection {
  readonly groupId: string;
  readonly labelId: string;
  readonly kind: TemplateTargetType;
  readonly templateId: string;
  readonly versionId: string;
}
/** Read matching active work through the same permission-scoped query as ordinary work lists. */
export function conversionWorkQuery(
  kind: TemplateTargetType,
  labelId: string,
  cursor?: string | null,
) {
  return WorkViewQueryRequest.parse({
    target: kind,
    definition: {
      version: 2,
      target: kind,
      filter: { kind: 'predicate', field: 'labels', operator: 'includesAll', operand: [labelId] },
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: [],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    context: { kind: 'organization' },
    activeOnly: true,
    limit: 100,
    ...(cursor ? { cursor } : {}),
  });
}
/** Include only explicit checked rows and the one stand-in label the person chose. */
export function conversionChoices(input: ConversionSelection, ids: readonly string[]) {
  return LabelTemplateConversionChoices.parse({
    labelGroupId: input.groupId,
    items: ids.map((id) => ({
      kind: input.kind,
      id,
      removeLabelIds: [input.labelId],
      workTypeId: input.templateId,
      workTypeVersionId: input.versionId,
    })),
  });
}
