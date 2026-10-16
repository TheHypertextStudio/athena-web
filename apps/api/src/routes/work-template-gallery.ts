import { Hono } from 'hono';
import { z } from 'zod';
import {
  WorkTemplateGalleryQuery,
  WorkTemplateGalleryItem,
  WorkTemplateGalleryDetail,
  WorkTemplateGalleryPreview,
  WorkTemplateGalleryPreviewRequest,
  WorkTemplateGalleryFork,
  WorkTemplateGalleryForkSet,
} from '@docket/work/template-gallery-contract';
import type { AppEnv } from '../context';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { apiDoc } from '../lib/openapi-route';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import {
  listTemplateGallery,
  getTemplateGalleryDetail,
  getTemplateGalleryFork,
} from '../lib/template-gallery/catalog';
import { previewTemplateGalleryCopy } from '../lib/template-gallery/preview';
import copies from './work-template-gallery-copies';

/** Released catalog discovery and read-only review; manual template use does not require Athena. */
const gallery = new Hono<AppEnv>()
  .route('/copies', copies)
  .get(
    '/',
    apiDoc({
      tag: 'Templates',
      summary: 'Browse released work definitions',
      response: pageOf(WorkTemplateGalleryItem),
    }),
    zQuery(CursorQuery.extend(WorkTemplateGalleryQuery.shape)),
    (c) => {
      const { cursor, limit, ...filters } = c.req.valid('query');
      return ok(
        c,
        pageOf(WorkTemplateGalleryItem),
        listTemplateGallery(filters, { limit, ...(cursor ? { cursor } : {}) }),
      );
    },
  )
  .get(
    '/forks/:fork',
    apiDoc({
      tag: 'Templates',
      summary: 'Select complete released starting work',
      response: WorkTemplateGalleryForkSet,
    }),
    zParam(z.object({ fork: WorkTemplateGalleryFork })),
    (c) => ok(c, WorkTemplateGalleryForkSet, getTemplateGalleryFork(c.req.valid('param').fork)),
  )
  .post(
    '/copy-preview',
    capabilityGuard('contribute', { sharedWorkMutation: false }),
    apiDoc({
      tag: 'Templates',
      summary: 'Review independent catalog copies',
      response: WorkTemplateGalleryPreview,
    }),
    zJson(WorkTemplateGalleryPreviewRequest),
    async (c) =>
      ok(
        c,
        WorkTemplateGalleryPreview,
        await previewTemplateGalleryCopy(c.get('actorCtx'), c.req.valid('json')),
      ),
  )
  .get(
    '/:slug',
    apiDoc({
      tag: 'Templates',
      summary: 'Preview a released work definition',
      response: WorkTemplateGalleryDetail,
    }),
    zParam(
      z.object({
        slug: z
          .string()
          .regex(/^[a-z][a-z0-9-]*$/)
          .max(100),
      }),
    ),
    (c) => ok(c, WorkTemplateGalleryDetail, getTemplateGalleryDetail(c.req.valid('param').slug)),
  );

export default gallery;
