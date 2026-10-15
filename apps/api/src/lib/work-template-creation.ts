import { db, template, workTypeTeam, workTypeVersion, type Database } from '@docket/db';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { WorkTemplateIdentity } from '@docket/work/work-template-reference';
import { and, eq, isNull } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '../error';
import { resolveAttachedLabels } from './labels';
import { loadStatusSets } from './work-status';

interface CreationSelection {
  workTypeId?: string | undefined;
  workTypeVersionId?: string | undefined;
  teamId?: string | undefined;
}
interface CreationDefaults {
  description?: string;
  workTypeId?: string | undefined;
  workTypeVersionId?: string | undefined;
  state?: string;
  status?: string;
  labels?: string[];
}

async function selectedDefinition(
  orgId: string,
  kind: TemplateTargetType,
  input: CreationSelection,
  database: Database,
) {
  const [row] = await database
    .select({ version: workTypeVersion })
    .from(template)
    .innerJoin(
      workTypeVersion,
      and(
        eq(workTypeVersion.workTypeId, template.id),
        eq(workTypeVersion.organizationId, template.organizationId),
        eq(workTypeVersion.id, input.workTypeVersionId ?? template.latestPublishedVersionId),
      ),
    )
    .where(
      and(
        eq(template.id, input.workTypeId ?? ''),
        eq(template.organizationId, orgId),
        eq(template.targetType, kind),
        eq(template.publicationState, 'published'),
        eq(template.scope, 'organization'),
        isNull(template.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Template not found');
  const offerings = await database
    .select({ teamId: workTypeTeam.teamId })
    .from(workTypeTeam)
    .where(
      and(
        eq(workTypeTeam.organizationId, orgId),
        eq(workTypeTeam.workTypeId, input.workTypeId ?? ''),
      ),
    );
  if (offerings.length > 0 && !offerings.some((offering) => offering.teamId === input.teamId)) {
    throw new ValidationError([
      { path: ['workTypeId'], message: 'Choose a template offered for this team.' },
    ]);
  }
  return row.version;
}

async function startingDefaults(
  orgId: string,
  kind: TemplateTargetType,
  input: CreationSelection,
  definition: WorkTemplateDefinition,
  database: Database,
): Promise<Record<string, unknown>> {
  const { targetType: _targetType, ...defaults } = definition.payload;
  const sets = await loadStatusSets(
    orgId,
    {
      entityTypes: [kind],
      teamIds: input.teamId ? [input.teamId] : [],
    },
    database,
  );
  const statuses = sets.for(kind, kind === 'task' ? input.teamId : null);
  const requested =
    definition.defaultStatusKey ?? ('status' in defaults ? defaults.status : undefined);
  const chosen =
    statuses.find(
      (status) =>
        status.key === requested || status.name.toLowerCase() === requested?.toLowerCase(),
    ) ?? sets.defaultOf(kind, kind === 'task' ? input.teamId : null);
  const result: Record<string, unknown> = { ...defaults };
  delete result['status'];
  if (chosen) result[kind === 'task' ? 'state' : 'status'] = chosen.key;
  if (definition.payload.targetType === 'task') {
    delete result['labelIds'];
    result['labels'] = (
      await resolveAttachedLabels(orgId, definition.payload.labelIds ?? [], database)
    ).map((label) => label.id);
  }
  return result;
}

/**
 * Apply a published snapshot through the existing create path, with explicit input taking precedence.
 * @throws {NotFoundError} For hidden, foreign, archived, mismatched or unpublished identities.
 * @throws {ValidationError} When the template is not offered to the destination team.
 */
export async function prepareWorkTemplateCreation<T extends CreationSelection>(
  orgId: string,
  kind: TemplateTargetType,
  input: T,
  database: Database = db,
): Promise<T & CreationDefaults> {
  if (input.workTypeVersionId && !input.workTypeId) {
    throw new ValidationError([
      { path: ['workTypeVersionId'], message: 'Choose the template together with its version.' },
    ]);
  }
  if (!input.workTypeId) return input;
  const version = await selectedDefinition(orgId, kind, input, database);
  const definition = WorkTemplateDefinition.parse(version.definition);
  const defaults = await startingDefaults(orgId, kind, input, definition, database);
  // An absent optional field must not erase its starting value; empty prose and null remain explicit.
  const explicit = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  return {
    ...defaults,
    ...explicit,
    workTypeId: version.workTypeId,
    workTypeVersionId: version.id,
  } as T & CreationDefaults;
}

/** Validate and serialize the complete association on current work responses. */
export function workTemplateIdentityOut(row: {
  workTypeId: string;
  workTypeVersionId: string;
  workTypeAssignedAt: Date;
  workTypeAssignmentSource: WorkTemplateIdentity['workTypeAssignmentSource'];
}): WorkTemplateIdentity {
  return WorkTemplateIdentity.parse({
    workTypeId: row.workTypeId,
    workTypeVersionId: row.workTypeVersionId,
    workTypeAssignedAt: row.workTypeAssignedAt.toISOString(),
    workTypeAssignmentSource: row.workTypeAssignmentSource,
  });
}
