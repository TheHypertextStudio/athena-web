import type {
  RelationCommandPort,
  RelationEndpoint,
  RelationIntent,
} from '@docket/work/relation-contract';

/** Program relations owned by the Program application domain. */
export type ProgramRelationId = 'program.initiative' | 'program.owner' | 'program.label';

/** Narrow Program intent accepted by the Program command port. */
export interface ProgramRelationIntent extends Omit<RelationIntent, 'relationId' | 'subjects'> {
  readonly relationId: ProgramRelationId;
  readonly subjects: readonly (RelationEndpoint & { readonly kind: 'program' })[];
}

/** Injected Program-owned persistence operations. */
export interface ProgramRelationDependencies {
  readonly setOwner: (organizationId: string, programId: string, ownerId: string) => Promise<void>;
  readonly linkInitiative: (
    organizationId: string,
    programId: string,
    initiativeId: string,
  ) => Promise<'applied' | 'unchanged'>;
  readonly addLabel: (
    organizationId: string,
    programId: string,
    labelId: string,
  ) => Promise<'applied' | 'unchanged'>;
}

/** Build the Program relation port from typed Program API operations. */
export function createProgramRelationCommandPort(
  dependencies: ProgramRelationDependencies,
): RelationCommandPort<ProgramRelationIntent> {
  return {
    execute: async (intent) => {
      let applied = false;
      for (const subject of intent.subjects) {
        const organizationId = subject.organizationId;
        if (
          organizationId === null ||
          intent.target.organizationId === null ||
          intent.target.organizationId !== organizationId
        )
          continue;
        if (intent.relationId === 'program.owner') {
          if (subject.meta?.['ownerId'] === intent.target.id) continue;
          await dependencies.setOwner(organizationId, subject.id, intent.target.id);
          applied = true;
        } else if (intent.relationId === 'program.initiative') {
          applied =
            (await dependencies.linkInitiative(organizationId, subject.id, intent.target.id)) ===
              'applied' || applied;
        } else {
          applied =
            (await dependencies.addLabel(organizationId, subject.id, intent.target.id)) ===
              'applied' || applied;
        }
      }
      return { status: applied ? 'applied' : 'unchanged' };
    },
  };
}
