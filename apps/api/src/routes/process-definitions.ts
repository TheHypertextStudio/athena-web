/** `@docket/api` — reusable process-definition routes. */
import { db } from '@docket/db';
import { CursorQuery, pageOf } from '../contracts/pagination';
import {
  ProcessDefinitionCreate,
  ProcessDefinitionDetailOut,
  ProcessDefinitionFromProjectCreate,
  ProcessDefinitionSummaryOut,
  ProcessDefinitionUpdate,
} from '../contracts/recurrence';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import {
  appendPublishedProcessRevision,
  archiveProcessDefinition,
  createPublishedProcessDefinition,
  listProcessDefinitions,
  loadProcessDefinitionDetail,
  updateProcessDefinitionMetadata,
} from '../lib/recurrence/process-definition';
import { created, ok } from '../lib/ok';
import { pageResultById } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { captureIdempotencyBody, idempotencyFor } from '../lib/idempotency';
import {
  authorizeProjectSnapshot,
  createProjectSnapshotWithReceipt,
  resumeProjectSnapshot,
} from './process-definition-creation';

const idParam = z.object({ id: z.string() });

/** Org-scoped authoring and immutable revision lifecycle for reusable processes. */
const processDefinitions = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Processes',
      summary: 'List process definitions',
      response: pageOf(ProcessDefinitionSummaryOut),
      description:
        'List reusable process blueprints in stable definition-id order. Pages default to 50 items, accept at most 100, and omit nextCursor at exhaustion. Each item reports its latest immutable revision number. Archived processes are excluded. Requires current workspace View and definition ownership or workspace Manage.',
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const items = await listProcessDefinitions(db, orgId, { cursor, limit }, actorId);
      return ok(c, pageOf(ProcessDefinitionSummaryOut), pageResultById(items, limit));
    },
  )
  .post(
    '/from-project',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Processes',
      summary: 'Make an existing project repeatable',
      capability: 'contribute',
      response: ProcessDefinitionDetailOut,
      description:
        'Snapshot one fully readable project tree, its milestones, tasks, labels, hierarchy, dependencies, and relative dates into a private published process revision. An optional Idempotency-Key atomically retains the original snapshot for 48 hours. Reuse it with the identical request to recover a lost response without creating another definition.',
      extra: {
        'x-docket-idempotency': 'atomic-receipt',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description: 'Caller-owned retry identity retained for 48 hours.',
            schema: { type: 'string', minLength: 1 },
          },
        ],
      },
    }),
    captureIdempotencyBody,
    zJson(ProcessDefinitionFromProjectCreate),
    authorizeProjectSnapshot,
    resumeProjectSnapshot,
    idempotencyFor('atomic-receipt'),
    async (c) => {
      const detail = await createProjectSnapshotWithReceipt(c, c.req.valid('json'));
      return ok(c, ProcessDefinitionDetailOut, detail);
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Processes',
      summary: 'Create a process definition',
      capability: 'contribute',
      response: ProcessDefinitionDetailOut,
      description:
        'Create and publish a reusable process with one immutable normalized revision. The graph may generate a project, milestones, ordinary tasks, dependencies, hierarchy, and relative timing.',
    }),
    zJson(ProcessDefinitionCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const published = await createPublishedProcessDefinition(db, {
        organizationId: orgId,
        actorId,
        definition: c.req.valid('json'),
      });
      const detail = await loadProcessDefinitionDetail(db, orgId, published.definitionId, actorId);
      return created(c, ProcessDefinitionDetailOut, detail);
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Processes',
      summary: 'Get a process definition',
      response: ProcessDefinitionDetailOut,
      description:
        'Get one private process you own or manage at workspace scope and reconstruct its latest immutable revision as named project, milestone, task, timing, and dependency specifications.',
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const detail = await loadProcessDefinitionDetail(db, orgId, c.req.valid('param').id, actorId);
      return ok(c, ProcessDefinitionDetailOut, detail);
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Processes',
      summary: 'Update process metadata',
      capability: 'contribute',
      response: ProcessDefinitionDetailOut,
      description:
        'Rename or redescribe a process definition without changing its executable revision. Use the revisions endpoint for work-graph changes so existing instances remain immutable.',
    }),
    zParam(idParam),
    zJson(ProcessDefinitionUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const detail = await updateProcessDefinitionMetadata(db, {
        organizationId: orgId,
        actorId,
        definitionId: c.req.valid('param').id,
        patch: c.req.valid('json'),
      });
      return ok(c, ProcessDefinitionDetailOut, detail);
    },
  )
  .post(
    '/:id/revisions',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Processes',
      summary: 'Publish a process revision',
      capability: 'contribute',
      response: ProcessDefinitionDetailOut,
      description:
        'Publish a complete immutable process revision. Future series occurrences may use it. Work already created from an older revision does not change.',
    }),
    zParam(idParam),
    zJson(ProcessDefinitionCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await appendPublishedProcessRevision(db, {
        organizationId: orgId,
        actorId,
        definitionId: id,
        revision: c.req.valid('json'),
      });
      const detail = await loadProcessDefinitionDetail(db, orgId, id, actorId);
      return ok(c, ProcessDefinitionDetailOut, detail);
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Processes',
      summary: 'Archive a process definition',
      capability: 'contribute',
      response: ProcessDefinitionSummaryOut,
      description:
        'Archive a reusable process and end its active series while preserving every immutable revision, occurrence, process instance, and generated work item.',
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const archived = await archiveProcessDefinition(db, orgId, c.req.valid('param').id, actorId);
      return ok(c, ProcessDefinitionSummaryOut, archived);
    },
  );

export default processDefinitions;
