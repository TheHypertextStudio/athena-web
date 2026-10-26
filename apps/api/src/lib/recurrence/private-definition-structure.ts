import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { recurrenceWorkTemplateDefinition } from './work-template-definition';
import type { RecurrenceBlueprintSource } from './work-template-source';

/**
 * Authored structure beneath one inline private root, rebuilt in memory from a verified publication.
 * It is never stored as a template; generated work records each step's registered private alias.
 */
export interface PrivateRootStructure {
  readonly invocationId: string;
  readonly rootKey: string;
  readonly definition: WorkTemplateDefinition;
  readonly stepAliases: Readonly<Record<string, string>>;
}

function inline(source: RecurrenceBlueprintSource): boolean {
  return typeof source.preset.fields['work_type_id'] !== 'string';
}

/**
 * Describe each inline authored root that has children; selected roots keep their publication structure.
 * @param name - Authored definition name, used only for the in-memory definition label.
 */
export function privateRootStructures(
  name: string,
  invocationId: string,
  sources: readonly RecurrenceBlueprintSource[],
): readonly PrivateRootStructure[] {
  return sources
    .filter((source) => source.id === source.rootId && inline(source))
    .flatMap((root) => {
      const children = sources.filter(
        (source) => source.rootId === root.id && source.id !== root.id,
      );
      if (!children.length) return [];
      return [
        {
          invocationId,
          rootKey: root.key,
          definition: recurrenceWorkTemplateDefinition(name, root, sources),
          stepAliases: Object.fromEntries(children.map((source) => [source.key, source.id])),
        },
      ];
    });
}
