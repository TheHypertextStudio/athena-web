import type { TemplateTargetType } from '@docket/work/template-contract';
import {
  WorkTemplateAssignment,
  WorkTemplateIdentity,
  WorkTemplateChangeRequest,
  WorkTemplateChangePreview,
} from '@docket/work/work-template-reference';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { deferAfterResponse } from '../lib/after-response';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { assignWorkTemplate, previewWorkTemplateAssignment } from '../lib/work-template-assignment';
import { zJson, zParam } from '../lib/validate';
import { enqueueSearchUpsert } from '../search/write-through';

/** Mount the shared reviewed template change operation under a work kind's existing resource router. */
export function workTemplateAssignmentRoutes(kind: TemplateTargetType) {
  return new Hono<AppEnv>()
    .post(
      '/:id/template/preview',
      apiDoc({
        tag: 'Templates',
        summary: 'Preview optional starting changes from a published template',
        response: WorkTemplateChangePreview,
        capability: kind === 'program' ? 'manage' : 'contribute',
      }),
      zParam(z.object({ id: z.string() })),
      zJson(WorkTemplateChangeRequest),
      async (c) =>
        ok(
          c,
          WorkTemplateChangePreview,
          await previewWorkTemplateAssignment(
            c.get('actorCtx'),
            kind,
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        ),
    )
    .post(
      '/:id/template/update',
      apiDoc({
        tag: 'Templates',
        summary: 'Apply reviewed changes from the current template',
        response: WorkTemplateIdentity,
        capability: kind === 'program' ? 'manage' : 'contribute',
      }),
      zParam(z.object({ id: z.string() })),
      zJson(WorkTemplateAssignment),
      async (c) => {
        const caller = c.get('actorCtx');
        const id = c.req.valid('param').id;
        const identity = await assignWorkTemplate(caller, kind, id, {
          ...c.req.valid('json'),
          mode: 'update',
        });
        deferAfterResponse('work-template-assignment-search', () =>
          enqueueSearchUpsert(caller.orgId, kind, id),
        );
        return ok(c, WorkTemplateIdentity, identity);
      },
    )
    .post(
      '/:id/template',
      apiDoc({
        tag: 'Templates',
        summary: 'Change a work item’s template identity',
        response: WorkTemplateIdentity,
        capability: kind === 'program' ? 'manage' : 'contribute',
        description:
          'Pin a published template of the same workspace and kind. Starting values change only when explicitly selected from a current preview. Existing dates and child work change only through individually accepted child choices from the same preview. Live resource access is checked before template selection; unavailable work returns 404.',
      }),
      zParam(z.object({ id: z.string() })),
      zJson(WorkTemplateAssignment),
      async (c) => {
        const caller = c.get('actorCtx');
        const id = c.req.valid('param').id;
        const identity = await assignWorkTemplate(caller, kind, id, c.req.valid('json'));
        deferAfterResponse('work-template-assignment-search', () =>
          enqueueSearchUpsert(caller.orgId, kind, id),
        );
        return ok(c, WorkTemplateIdentity, identity);
      },
    );
}
