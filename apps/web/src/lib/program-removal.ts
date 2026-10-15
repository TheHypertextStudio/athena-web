import type { ProgramOut } from '@docket/work/program-contract';
import { api } from './api';
import { ApiRequestError, unwrap } from './query-core';

/** Remove a Program through the typed API, explaining retained recurring-work history conflicts. */
export async function removeProgram(
  orgId: string,
  programId: string,
  programLabel: string,
): Promise<ProgramOut> {
  try {
    return await unwrap(
      () => api.v1.orgs[':orgId'].programs[':id'].$delete({ param: { orgId, id: programId } }),
      `Could not delete this ${programLabel.toLowerCase()}.`,
    );
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409 && error.code === 'conflict') {
      throw new ApiRequestError({
        message: `Archive this ${programLabel.toLowerCase()} to keep its recurring work and run history.`,
        status: error.status,
        code: error.code,
        organizationId: error.organizationId,
        cause: error,
      });
    }
    throw error;
  }
}
