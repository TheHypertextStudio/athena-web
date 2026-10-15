import { db } from '@docket/db';
import { WorkTypeId } from '@docket/work/ids';
import { BlueprintCreationPreview } from '@docket/work/work-template-blueprint';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { WorkTemplateBlueprintPreviewRequest } from '../contracts/work-template-blueprint';
import { ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { appProvenance, originFor } from '../lib/provenance/context';
import { previewBlueprintCreation } from '../lib/work-template-blueprints/preview';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

/** Read-only creation reviews use the same typed bodies and authorization as actual creation. */
const blueprints = new Hono<AppEnv>().post(
  '/:id/blueprint-preview',
  capabilityGuard('contribute'),
  apiDoc({
    tag: 'Templates',
    summary: 'Preview work-template children',
    response: BlueprintCreationPreview,
  }),
  zParam(z.object({ id: WorkTypeId })),
  zJson(WorkTemplateBlueprintPreviewRequest),
  async (c) => {
    const input = c.req.valid('json');
    const workTypeId = c.req.valid('param').id;
    if (input.body.workTypeId && input.body.workTypeId !== workTypeId)
      throw new ValidationError([
        {
          message: 'Choose the same template for the preview and root.',
          path: ['body', 'workTypeId'],
        },
      ]);
    const common = {
      caller: c.get('actorCtx'),
      invocation: { origin: originFor(`${input.kind}_create`, {}, appProvenance()) },
    };
    const result = await db.transaction(
      (tx) => {
        switch (input.kind) {
          case 'task':
            return previewBlueprintCreation(
              tx,
              { ...common, kind: 'task', body: { ...input.body, workTypeId } },
              input.options,
              input.summaryOffset,
            );
          case 'project':
            return previewBlueprintCreation(
              tx,
              { ...common, kind: 'project', body: { ...input.body, workTypeId } },
              input.options,
              input.summaryOffset,
            );
          case 'initiative':
            return previewBlueprintCreation(
              tx,
              { ...common, kind: 'initiative', body: { ...input.body, workTypeId } },
              input.options,
              input.summaryOffset,
            );
          case 'program':
            return previewBlueprintCreation(
              tx,
              { ...common, kind: 'program', body: { ...input.body, workTypeId } },
              input.options,
              input.summaryOffset,
            );
        }
      },
      { isolationLevel: 'serializable' },
    );
    return ok(c, BlueprintCreationPreview, result);
  },
);

export default blueprints;
