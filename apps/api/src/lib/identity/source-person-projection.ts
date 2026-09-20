import type { SourcePersonReferenceOut } from '@docket/connections/integration-contract';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { z } from 'zod';

/** Read active source people within an authorized entity query without another database round trip. */
export function sourcePersonProjection(
  organizationId: SQLWrapper,
  subjectType: 'task' | 'project',
  subjectId: SQLWrapper,
): SQL<z.input<typeof SourcePersonReferenceOut>[]> {
  return sql<z.input<typeof SourcePersonReferenceOut>[]>`coalesce((
    select json_agg(json_build_object(
      'id', sp.id, 'externalActorId', ea.id, 'integrationId', i.id,
      'provider', i.provider, 'externalId', ea.external_id, 'displayName', ea.display_name,
      'avatarUrl', ea.avatar_url, 'actorId', ea.actor_id, 'field', sp.field,
      'canonicalDisplayName', canonical_person.display_name,
      'canonicalAvatarUrl', canonical_person.avatar,
      'updatedAt', to_char(ea.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )) from source_person_reference sp
    join external_actor ea on ea.id = sp.external_actor_id and ea.organization_id = ${organizationId}
    join integration i on i.id = ea.integration_id and i.organization_id = ${organizationId}
    left join actor canonical_person on canonical_person.id = ea.actor_id and canonical_person.organization_id = ${organizationId}
    where sp.organization_id = ${organizationId} and sp.subject_type = ${subjectType}
      and sp.subject_id = ${subjectId} and sp.detached_at is null
  ), '[]'::json)`;
}
