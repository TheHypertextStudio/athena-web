import { z } from 'zod';
import {
  DeliverableDraftOut,
  DeliverableOut,
  DeliverableUploadSessionOut,
} from '@docket/work/attachment-contract';
import {
  createDeliverableUploadSession,
  discardDeliverable,
  listDeliverables,
  listDraftDeliverables,
  uploadDeliverable,
} from '../content/deliverables';
import { MAX_ATTACHMENT_BYTES } from '../content/attachment-file';
import type { McpRegistrar } from './catalog';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';
import { assertSharedWorkWritable } from '../product-capability';
import { ValidationError } from '../error';
import { env } from '../env';

const encodedFile = z
  .string()
  .min(4)
  .max(4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3))
  .refine(
    (value) =>
      value.length <= 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3) &&
      Buffer.from(value, 'base64').toString('base64') === value,
    { message: 'Provide canonical base64 file bytes.' },
  )
  .refine((value) => Buffer.byteLength(value, 'base64') <= MAX_ATTACHMENT_BYTES, {
    message: 'Files must be no larger than 4 MB.',
  });

const uploadInput = z
  .object({
    orgId: orgIdParam,
    fileName: z.string().trim().min(1).max(255),
    mimeType: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
      .default('application/octet-stream'),
    base64: encodedFile.optional(),
    textContent: z
      .string()
      .min(1)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_ATTACHMENT_BYTES)
      .optional(),
    uploadId: z
      .uuid()
      .optional()
      .describe(
        'Optional retry identity. Reuse it with identical file details and bytes after an uncertain upload result.',
      ),
    title: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => (value.base64 === undefined) !== (value.textContent === undefined), {
    path: ['textContent'],
    message: 'Provide either textContent or base64.',
  });

const uploadSessionInput = z.object({
  orgId: orgIdParam,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
    .default('application/octet-stream'),
  title: z.string().trim().min(1).max(500).optional(),
});

/** Register private file upload and post attachment reads for agents. */
export function registerDeliverableTools(server: McpRegistrar, ctx: McpContext): void {
  registerDeliverableUploadSessionTool(server, ctx);
  server.registerTool(
    'upload_deliverable',
    {
      title: 'Upload deliverable',
      description:
        'Upload generated text by passing textContent directly (UTF-8, at most 4 MB); this avoids base64 expansion and preserves the original text. For binary media, pass canonical base64 bytes. The server cannot read local paths. Reuse uploadId with identical file details and bytes after an uncertain upload result. Recover private uploads with list_my_deliverable_drafts, then attach their IDs to comment or report_status. Drafts expire after seven days; up to ten files per post. Never send credentials or upload work without permission.',
      inputSchema: uploadInput.shape,
      outputSchema: DeliverableOut.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const parsed = uploadInput.safeParse(input);
        if (!parsed.success) throw new ValidationError(parsed.error);
        const actor = await scopedActor(ctx, parsed.data.orgId, 'work:write');
        await assertSharedWorkWritable(parsed.data.orgId);
        const bytes =
          parsed.data.base64 === undefined
            ? new TextEncoder().encode(parsed.data.textContent)
            : new Uint8Array(Buffer.from(parsed.data.base64, 'base64'));
        return jsonResult(
          await uploadDeliverable(
            parsed.data.orgId,
            actor.actorId,
            {
              name: parsed.data.fileName,
              type: parsed.data.mimeType,
              bytes,
            },
            parsed.data.title,
            parsed.data.uploadId,
          ),
        );
      }),
  );
  registerDeliverableReadTools(server, ctx);
}

function registerDeliverableReadTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'list_my_deliverable_drafts',
    {
      title: 'Recover my deliverable drafts',
      description:
        'List your own unexpired private uploads after interruption. Draft ownership includes the verified performer and connected client. Attach a returned id to comment or report_status; unclaimed drafts expire after seven days.',
      inputSchema: { orgId: orgIdParam },
      outputSchema: { items: z.array(DeliverableDraftOut) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actor = await scopedActor(ctx, input.orgId, 'work:read');
        return jsonResult({ items: await listDraftDeliverables(input.orgId, actor.actorId) });
      }),
  );
  server.registerTool(
    'list_deliverables',
    {
      title: 'List deliverables',
      description:
        'List files attached to a comment or status update. Requires current access to the parent work. Read uploaded bytes through get_resources and its content URI using kind attachment and the returned file id.',
      inputSchema: {
        orgId: orgIdParam,
        subjectType: z.enum(['comment', 'update']),
        subjectId: z.string().min(1),
      },
      outputSchema: { items: z.array(DeliverableOut) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actor = await scopedActor(ctx, input.orgId, 'work:read');
        return jsonResult({
          items: await listDeliverables(
            input.orgId,
            actor.actorId,
            input.subjectType,
            input.subjectId,
          ),
        });
      }),
  );
  server.registerTool(
    'discard_deliverable',
    {
      title: 'Discard pending deliverable',
      description:
        'Remove an unattached upload belonging to this performer. Posted files stay with their post.',
      inputSchema: { orgId: orgIdParam, id: z.string().min(1) },
      outputSchema: { removed: z.literal(true) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actor = await scopedActor(ctx, input.orgId, 'work:write');
        await discardDeliverable(input.orgId, actor.actorId, input.id);
        return jsonResult({ removed: true });
      }),
  );
}

function registerDeliverableUploadSessionTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'create_deliverable_upload_session',
    {
      title: 'Prepare a deliverable upload',
      description:
        'Create a 15-minute, upload-only URL for a file in your local agent workspace. Pass orgId, fileName, and optional mimeType/title. Then stream the local file as multipart field `file` to uploadUrl with header `X-Docket-Upload-Token: uploadToken`; this avoids base64 and keeps the MCP request small. The token can upload only that file, expires after 15 minutes, and retries must use the same bytes. The result is a private draft; include its returned file id from the upload response in comment or report_status. Never share the token or upload work without permission.',
      inputSchema: uploadSessionInput.shape,
      outputSchema: DeliverableUploadSessionOut.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const parsed = uploadSessionInput.safeParse(input);
        if (!parsed.success) throw new ValidationError(parsed.error);
        const actor = await scopedActor(ctx, parsed.data.orgId, 'work:write');
        await assertSharedWorkWritable(parsed.data.orgId);
        const session = await createDeliverableUploadSession(parsed.data.orgId, actor.actorId, {
          fileName: parsed.data.fileName,
          mimeType: parsed.data.mimeType,
          ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
        });
        return jsonResult(
          DeliverableUploadSessionOut.parse({
            uploadUrl: new URL(
              `/v1/deliverable-uploads/${encodeURIComponent(session.id)}`,
              new URL(env.API_URL).origin,
            ).toString(),
            uploadToken: session.token,
            fileName: parsed.data.fileName,
            expiresAt: session.expiresAt.toISOString(),
          }),
        );
      }),
  );
}
