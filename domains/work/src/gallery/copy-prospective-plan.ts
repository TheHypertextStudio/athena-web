import { BlueprintError, requireBlueprintValue } from '../blueprints/errors';
import { copyFacts } from './copy-facts';
import { CopySourceIdentity, copyIdentityKey } from './copy-identity';
import { ProspectiveCopyCatalog, authoredCopyReferences } from './copy-prospective-source';
import {
  prospectiveCopyClosure,
  validateProspectiveCopyExpansion,
} from './copy-prospective-closure';
import {
  ProspectiveCopyDestinations,
  prospectiveOfferingTeams,
} from './copy-prospective-destination';
import { rewriteProspectiveCopyDefinition } from './copy-prospective-rewrite';
import { prospectiveCopyReviewFingerprint } from './copy-review-fingerprint';
import type {
  ProspectiveCopyOmission,
  ReservedTemplateCopyInput,
  ReservedTemplateCopyPlan,
  TemplateCopySourcesInput,
  TemplateCopySourcesPreview,
} from './copy-prospective-types';

function prepare(input: TemplateCopySourcesInput) {
  const catalog = new ProspectiveCopyCatalog(input),
    selected = prospectiveCopyClosure(catalog, input.roots);
  const keys = new Set(selected.map((source) => copyIdentityKey(source.identity)));
  for (const choice of [
    ...(input.documentEdits ?? []),
    ...(input.offeringChoices ?? []),
    ...(input.suggestedLabelMappings ?? []),
  ])
    if (!keys.has(copyIdentityKey(choice.source)))
      throw new BlueprintError(
        'blueprint_invalid',
        'Copy decisions must name a selected exact source.',
      );
  for (const source of selected) {
    validateProspectiveCopyExpansion(catalog, source);
    prospectiveOfferingTeams(input, source.identity);
  }
  const roots = [
    ...new Map(
      input.roots.map((identity) => [
        copyIdentityKey(identity),
        CopySourceIdentity.parse(identity),
      ]),
    ).entries(),
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, identity]) => identity);
  return { catalog, selected, roots };
}
function sortedOmissions(omissions: readonly ProspectiveCopyOmission[]): ProspectiveCopyOmission[] {
  return [...omissions].sort((left, right) => copyFacts(left).localeCompare(copyFacts(right)));
}
/** Validate source/decision semantics before IDs are allocated; output carries no executable publication/projection facts. */
export async function previewTemplateCopySources(
  input: TemplateCopySourcesInput,
): Promise<TemplateCopySourcesPreview> {
  const { catalog, selected, roots } = prepare(input);
  const rewritten = new Map(
    selected.map((source) => [
      copyIdentityKey(source.identity),
      rewriteProspectiveCopyDefinition(input, source, catalog, null),
    ]),
  );
  const omissions = [...rewritten.values()].flatMap((value) => value.omissions);
  return {
    reviewFingerprint: await prospectiveCopyReviewFingerprint(input, catalog, selected),
    roots,
    copies: selected.map((source) => ({
      source: source.identity,
      sourceFingerprint: source.fingerprint,
      kind: source.kind,
      previewDefinition: requireBlueprintValue(rewritten.get(copyIdentityKey(source.identity)))
        .definition,
      offeredTeamIds: prospectiveOfferingTeams(input, source.identity),
      dependencies: [
        ...new Map(
          authoredCopyReferences(source).map((entry) => {
            const target = catalog.resolve(source, entry.slot).identity;
            return [copyIdentityKey(target), target] as const;
          }),
        ).entries(),
      ]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, target]) => target),
    })),
    omissions: sortedOmissions(omissions),
  };
}
/** Render canonical independent drafts with explicit reserved first-publication pins, never claiming actual publications exist. */
export async function planTemplateCopySources(
  input: ReservedTemplateCopyInput,
): Promise<ReservedTemplateCopyPlan> {
  const { catalog, selected, roots } = prepare(input),
    destinations = new ProspectiveCopyDestinations(input, selected);
  const omissions: ProspectiveCopyOmission[] = [];
  const copies = selected.map((source) => {
    const rewritten = rewriteProspectiveCopyDefinition(input, source, catalog, destinations);
    omissions.push(...rewritten.omissions);
    return {
      ...destinations.require(source.identity),
      organizationId: input.destinationOrganizationId,
      sourceFingerprint: source.fingerprint,
      definition: rewritten.definition,
      offeredTeamIds: prospectiveOfferingTeams(input, source.identity),
    };
  });
  return {
    reviewFingerprint: await prospectiveCopyReviewFingerprint(input, catalog, selected),
    copies,
    roots: roots.map((identity) => destinations.require(identity)),
    omissions: sortedOmissions(omissions),
  };
}
