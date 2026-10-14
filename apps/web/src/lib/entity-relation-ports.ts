/**
 * The Project and Program relation command ports, bound to this app's typed API.
 *
 * @remarks
 * Only the wiring: which endpoint each relation writes through, and the application-owned sentence
 * shown when one refuses. The rules about what a relation *means* live in the domain ports these
 * feed. Kept out of the action registration so that function stays a list of actions rather than a
 * list of actions after ninety lines of fetch calls.
 */
import { ProgramUpdate } from '@docket/work/program-contract';
import type { RelationCommandPort } from '@docket/work/relation-contract';

import { ProjectUpdate } from '@/lib/contracts/project';
import { createProgramRelationCommandPort } from '@/components/programs/program-relation-port';
import type { ProgramRelationIntent } from '@/components/programs/program-relation-port';
import { createProjectRelationCommandPort } from '@/components/projects/project-relation-port';
import type { ProjectRelationIntent } from '@/components/projects/project-relation-port';
import { api } from '@/lib/api';
import { UserFacingError } from '@/lib/problem';
import { unwrap } from '@/lib/query';

/** The two ports the entity navigation actions execute relations through. */
export interface RelationPorts {
  readonly projectPort: RelationCommandPort<ProjectRelationIntent>;
  readonly programPort: RelationCommandPort<ProgramRelationIntent>;
}

/**
 * Treat a duplicate write as a no-op.
 *
 * @remarks
 * A relation that already exists answers 409, and re-asserting one is not a failure — it is the
 * same end state the caller asked for. Reporting it as `unchanged` is what keeps a re-drop quiet.
 *
 * @param write - The relation write.
 * @returns Whether anything changed.
 */
const duplicateAsNoOp = async (write: () => Promise<unknown>): Promise<'applied' | 'unchanged'> => {
  try {
    await write();
    return 'applied';
  } catch (error) {
    if (error instanceof UserFacingError && error.status === 409) return 'unchanged';
    throw error;
  }
};

/** The Project port: which endpoint each Project relation writes through. */
function projectRelationPort(): RelationCommandPort<ProjectRelationIntent> {
  return createProjectRelationCommandPort({
    patchProject: async (organizationId, projectId, patch) => {
      await unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId: organizationId, id: projectId },
            json: ProjectUpdate.parse(patch),
          }),
        'Could not change the project relationship.',
      );
    },
    linkInitiative: (organizationId, projectId, initiativeId) =>
      duplicateAsNoOp(() =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
              param: { orgId: organizationId, id: initiativeId },
              json: { projectId },
            }),
          'Could not link the project to the initiative.',
        ),
      ),
    addLabel: async (organizationId, projectId, labelId) => {
      await unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].labels.$post({
            param: { orgId: organizationId, id: projectId },
            json: { labelId },
          }),
        'Could not add the project label.',
      );
      return 'applied';
    },
    addDependency: (organizationId, blockingProjectId, blockedProjectId) =>
      duplicateAsNoOp(() =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].projects[':id'].dependencies.$post({
              param: { orgId: organizationId, id: blockingProjectId },
              json: { blockedProjectId },
            }),
          'Could not create the project dependency.',
        ),
      ),
  });
}

/** The Program port: which endpoint each Program relation writes through. */
function programRelationPort(): RelationCommandPort<ProgramRelationIntent> {
  return createProgramRelationCommandPort({
    setOwner: async (organizationId, programId, ownerId) => {
      await unwrap(
        () =>
          api.v1.orgs[':orgId'].programs[':id'].$patch({
            param: { orgId: organizationId, id: programId },
            json: ProgramUpdate.parse({ ownerId }),
          }),
        'Could not set the program owner.',
      );
    },
    linkInitiative: (organizationId, programId, initiativeId) =>
      duplicateAsNoOp(() =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].programs.$post({
              param: { orgId: organizationId, id: initiativeId },
              json: { programId },
            }),
          'Could not link the program to the initiative.',
        ),
      ),
    addLabel: (organizationId, programId, labelId) =>
      duplicateAsNoOp(() =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].programs[':id'].labels.$post({
              param: { orgId: organizationId, id: programId },
              json: { labelId },
            }),
          'Could not add the program label.',
        ),
      ),
  });
}

/**
 * Build both relation ports.
 *
 * @returns The {@link RelationPorts}.
 */
export function createRelationPorts(): RelationPorts {
  return { projectPort: projectRelationPort(), programPort: programRelationPort() };
}
