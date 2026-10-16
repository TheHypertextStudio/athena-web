import { copyFacts } from './copy-facts';
import { fingerprintCopyFacts } from './copy-fingerprint';
import { copyIdentityKey } from './copy-identity';
import type { CopyDefinitionSource, TemplateCopySourcesInput } from './copy-prospective-types';
import type { ProspectiveCopyCatalog } from './copy-prospective-source';

function sorted(values: readonly unknown[]): string[] {
  return [...new Set(values.map(copyFacts))].sort();
}
/** Fingerprint all selected normalized bodies and reviewed decisions before allocating destination identities. */
export async function prospectiveCopyReviewFingerprint(
  input: TemplateCopySourcesInput,
  catalog: ProspectiveCopyCatalog,
  selected: readonly CopyDefinitionSource[],
): Promise<string> {
  const keys = new Set(selected.map((source) => copyIdentityKey(source.identity)));
  const facts = {
    destinationOrganizationId: input.destinationOrganizationId,
    roots: [...new Set(input.roots.map(copyIdentityKey))].sort(),
    sources: sorted(selected),
    bindings: sorted(
      [...catalog.bindings.values()].filter((binding) => keys.has(copyIdentityKey(binding.source))),
    ),
    labels: sorted(input.labelMappings ?? []),
    suggestedLabels: sorted(input.suggestedLabelMappings ?? []),
    offerings: sorted(
      (input.offeringChoices ?? []).map((choice) => ({
        ...choice,
        teamIds: [...new Set(choice.teamIds)].sort(),
      })),
    ),
    documents: sorted(input.documentEdits ?? []),
  };
  return fingerprintCopyFacts(facts);
}
