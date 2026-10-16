import { LabelId } from '../ids';
import { BlueprintError } from '../blueprints/errors';
import { WorkTemplateDefinition } from '../contracts/work-template';
import type { BlueprintStep } from '../contracts/work-template-blueprint';
import { copyIdentityKey } from './copy-identity';
import type { ProspectiveCopyCatalog } from './copy-prospective-source';
import type { ProspectiveCopyDestinations } from './copy-prospective-destination';
import { prospectiveSuggestedLabels } from './copy-prospective-labels';
import type {
  ProspectiveCopyDocumentEdit,
  ProspectiveCopyOmission,
  CopyDefinitionSource,
  TemplateCopySourcesInput,
} from './copy-prospective-types';

interface Rewrite {
  readonly input: TemplateCopySourcesInput;
  readonly source: CopyDefinitionSource;
  readonly omissions: ProspectiveCopyOmission[];
}
function labels(
  fields: Readonly<Record<string, unknown>>,
  state: Rewrite,
  path: readonly (string | number)[],
): Record<string, unknown> {
  if (!Array.isArray(fields['labelIds'])) return { ...fields };
  const mapped: string[] = [];
  for (const raw of fields['labelIds']) {
    const labelId = LabelId.parse(raw);
    const matches =
      state.input.labelMappings?.filter(
        (entry) =>
          entry.sourceOrganizationId ===
            (state.source.identity.kind === 'catalog'
              ? null
              : state.source.identity.organizationId) && entry.sourceLabelId === labelId,
      ) ?? [];
    const destination = matches[0]?.destinationLabelId;
    if (matches.some((entry) => entry.destinationLabelId !== destination))
      throw new BlueprintError('blueprint_invalid', 'Conflicting destination label mapping.');
    if (destination) mapped.push(LabelId.parse(destination));
    else
      state.omissions.push({
        source: state.source.identity,
        kind: 'label',
        path,
        count: 1,
        value: labelId,
      });
  }
  return { ...fields, labelIds: [...new Set(mapped)] };
}
function pinned(
  source: CopyDefinitionSource,
  slot: { readonly kind: 'blueprint_step' | 'default_schedule'; readonly key: string },
  reference: NonNullable<BlueprintStep['template']>,
  catalog: ProspectiveCopyCatalog,
  destinations: ProspectiveCopyDestinations | null,
) {
  if (!destinations) return reference;
  const chosen = destinations.require(catalog.resolve(source, slot).identity);
  return {
    workTypeId: chosen.workTypeId,
    selection: { kind: 'pinned' as const, workTypeVersionId: chosen.reservedFirstPublicationId },
  };
}
function blueprintDocument(
  definition: WorkTemplateDefinition,
  edit: ProspectiveCopyDocumentEdit,
): { description?: string | null | undefined } {
  if (
    edit.path.length === 5 &&
    edit.path[0] === 'blueprint' &&
    edit.path[1] === 'steps' &&
    typeof edit.path[2] === 'number' &&
    edit.path[3] === 'fields' &&
    edit.path[4] === 'description'
  ) {
    const step = definition.blueprint.steps[edit.path[2]];
    if (step) return step.fields;
  }
  throw new BlueprintError(
    'blueprint_invalid',
    'Image decisions must name an exact reusable document.',
  );
}
function documentFields(
  definition: WorkTemplateDefinition,
  edit: ProspectiveCopyDocumentEdit,
): { description?: string | null | undefined } {
  if (edit.path.length === 1 && edit.path[0] === 'description') return definition;
  if (edit.path.length === 2 && edit.path[0] === 'payload' && edit.path[1] === 'description')
    return definition.payload;
  return blueprintDocument(definition, edit);
}
function editDocuments(definition: WorkTemplateDefinition, state: Rewrite): void {
  const paths = new Set<string>();
  for (const edit of state.input.documentEdits ?? []) {
    if (copyIdentityKey(edit.source) !== copyIdentityKey(state.source.identity)) continue;
    const path = JSON.stringify(edit.path),
      fields = documentFields(definition, edit);
    if (
      paths.has(path) ||
      fields.description !== edit.original ||
      !Number.isInteger(edit.omittedImageCount) ||
      edit.omittedImageCount < 0
    )
      throw new BlueprintError(
        'blueprint_invalid',
        'Image document decision is stale or duplicated.',
      );
    paths.add(path);
    fields.description = edit.replacement;
    if (edit.omittedImageCount)
      state.omissions.push({
        source: state.source.identity,
        kind: 'image',
        path: edit.path,
        count: edit.omittedImageCount,
      });
  }
}
function suggestions(state: Rewrite): void {
  for (const teamId of state.source.offeredTeamIds ?? [])
    state.omissions.push({
      source: state.source.identity,
      kind: 'offering',
      path: ['offeredTeamIds'],
      count: 1,
      value: teamId,
    });
  for (const suggestion of state.source.offeringSuggestions ?? [])
    state.omissions.push({
      source: state.source.identity,
      kind: 'offering_suggestion',
      path: ['offeringSuggestions'],
      count: 1,
      value: suggestion,
    });
}
/** Rewrite every explicit template reference and clear unmapped local data without mutating source facts. */
export function rewriteProspectiveCopyDefinition(
  input: TemplateCopySourcesInput,
  source: CopyDefinitionSource,
  catalog: ProspectiveCopyCatalog,
  destinations: ProspectiveCopyDestinations | null,
): { definition: WorkTemplateDefinition; omissions: readonly ProspectiveCopyOmission[] } {
  const state: Rewrite = { input, source, omissions: [] },
    original = source.definition;
  const suggested = prospectiveSuggestedLabels(
    input,
    source,
    labels(original.payload, state, ['payload', 'labelIds']),
  );
  state.omissions.push(...suggested.omissions);
  const definition = WorkTemplateDefinition.parse({
    ...original,
    payload: suggested.payload,
    blueprint: {
      ...original.blueprint,
      steps: original.blueprint.steps.map((step, index) => ({
        ...step,
        fields: labels(step.fields, state, ['blueprint', 'steps', index, 'fields', 'labelIds']),
        template: step.template
          ? pinned(
              source,
              { kind: 'blueprint_step', key: step.key },
              step.template,
              catalog,
              destinations,
            )
          : null,
      })),
    },
    defaultSchedules: original.defaultSchedules.map((schedule) => ({
      ...schedule,
      template: {
        targetType: schedule.template.targetType,
        ...pinned(
          source,
          { kind: 'default_schedule', key: schedule.key },
          schedule.template,
          catalog,
          destinations,
        ),
      },
    })),
  });
  editDocuments(definition, state);
  suggestions(state);
  return { definition: WorkTemplateDefinition.parse(definition), omissions: state.omissions };
}
