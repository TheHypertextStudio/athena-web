import { jsonResponse } from '../support/http';

/** Return one local entity for the requested workspace's mention search. */
export function mentionSearchResponse({
  param,
}: {
  readonly param: { readonly orgId: string };
}): Promise<Response> {
  return Promise.resolve(
    jsonResponse(true, {
      items: [
        {
          origin: 'local',
          id: `task_${param.orgId}`,
          ref: { kind: 'entity', entityKind: 'task', entityId: `task_${param.orgId}` },
          entityKind: 'task',
          title: `Roadmap in ${param.orgId}`,
          subtitle: null,
          href: `/orgs/${param.orgId}/tasks/task_${param.orgId}`,
          score: 1,
        },
      ],
    }),
  );
}
