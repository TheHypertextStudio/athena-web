import {
  WorkTemplateCapturePreview,
  WorkTemplateCaptureRequest,
  WorkTemplateCaptureResult,
} from '@docket/work/work-template-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import {
  previewWorkTemplateCapture,
  saveWorkTemplateCapture,
} from '../lib/work-template-blueprints/capture';
import { zJson, zParam } from '../lib/validate';

/** Mount independent private Save-as capture under each existing authored work resource. */
export function workTemplateCaptureRoutes(kind: TemplateTargetType) {
  return new Hono<AppEnv>()
    .post(
      '/:id/template/save-as/preview',
      apiDoc({
        tag: 'Templates',
        summary: 'Review an independent reusable outline from current work',
        response: WorkTemplateCapturePreview,
        description:
          'Requires live source view rights and the workspace template authoring policy. Returns the complete authorized outline and review warnings. Hidden descendants or inaccessible images refuse the capture without exposing their content.',
      }),
      zParam(z.object({ id: z.string() })),
      async (c) =>
        ok(
          c,
          WorkTemplateCapturePreview,
          await previewWorkTemplateCapture(c.get('actorCtx'), kind, c.req.valid('param').id),
        ),
    )
    .post(
      '/:id/template/save-as',
      apiDoc({
        tag: 'Templates',
        summary: 'Save a reviewed outline as a personal unpublished template',
        response: WorkTemplateCaptureResult,
        status: 201,
        description:
          'Creates an independent author-only draft from the exact reviewed source snapshot and warnings. A changed source returns409. Source work remains unchanged and publication requires a separate explicit action.',
      }),
      zParam(z.object({ id: z.string() })),
      zJson(WorkTemplateCaptureRequest),
      async (c) =>
        created(
          c,
          WorkTemplateCaptureResult,
          await saveWorkTemplateCapture({
            actor: c.get('actorCtx'),
            kind,
            id: c.req.valid('param').id,
            request: c.req.valid('json'),
          }),
        ),
    );
}
