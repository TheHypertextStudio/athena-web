import { detachEditedSourcePeople } from '../identity/source-people';
import type { SourcePersonTransaction } from '../identity/source-person-assignment';
import type { WorkViewOrderRequest } from '@docket/work/work-view-contract';
import { ApiError } from '../../error';

/** Validate a string mutation operand. */
export function stringValue(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  throw new TypeError(`Mutable group ${field} requires a string value.`);
}

/** Validate a nullable mutation operand. */
export function nullableStringValue(value: unknown, field: string): string | null {
  return value === null ? null : stringValue(value, field);
}

/** Source identity group keys are provenance, never native assignment values. */
export function assertMutableGroupRequest(request: WorkViewOrderRequest): void {
  const values = [
    request.groupValue,
    ...('sourceGroupValue' in request ? [request.sourceGroupValue] : []),
  ];
  if (values.some((value) => typeof value === 'string' && value.startsWith('source-person:'))) {
    throw new ApiError(
      400,
      'validation_error',
      'Resolve the source person before changing this group.',
    );
  }
}

/** An explicit native person group move supersedes any imported assignment. */
export async function detachGroupedSourcePerson(
  tx: Pick<SourcePersonTransaction, 'update'>,
  orgId: string,
  request: WorkViewOrderRequest,
): Promise<void> {
  await detachEditedSourcePeople(
    {
      orgId,
      subjectType: request.target,
      subjectId: request.itemId,
      field: request.groupField ?? '',
      value: ['assignee', 'lead'].includes(request.groupField ?? '')
        ? request.groupValue
        : undefined,
    },
    tx,
  );
}

/** Resolve the persisted order context to its native entity identifier. */
export function contextId(
  context: WorkViewOrderRequest['context'],
  organizationId: string,
): string {
  switch (context.kind) {
    case 'organization':
      return organizationId;
    case 'team':
      return context.teamId;
    case 'project':
      return context.projectId;
    case 'program':
      return context.programId;
    case 'initiative':
      return context.initiativeId;
  }
}
