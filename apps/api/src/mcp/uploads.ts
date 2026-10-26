import { z } from 'zod';
import { UploadBegin, UploadSessionOut } from '../contracts/uploads';
import { beginUpload, completeUpload, readUpload } from '../content/upload-session';
import { cancelUpload } from '../content/upload-cleanup';
import { ValidationError } from '../error';
import type { McpRegistrar } from './catalog';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor } from './result';

const input = z.object({
  orgId: z.string(),
  action: z.enum(['begin', 'status', 'complete', 'cancel']),
  uploadId: z.string().optional(),
  requestId: z.string().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  title: z.string().optional(),
  byteSize: z.number().optional(),
  crc32c: z.string().optional(),
  destination: z
    .object({
      kind: z.enum(['draft', 'work']),
      subjectType: z.enum(['task', 'project', 'program', 'initiative']).optional(),
      subjectId: z.string().optional(),
    })
    .optional(),
});
/** One compact management tool; file bytes travel through the resumable PUT capability. */
export function registerUploadTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'manage_upload',
    {
      title: 'Manage a file upload',
      description:
        'Files up to 100 MiB. Begin: requestId, fileName, byteSize, base64 CRC32C, destination. PUT Content-Range chunks to secret uploadUrl; use X-Docket-Upload-Token if returned. Resume at offset; complete for file.id. Draft IDs attach to posts.',
      inputSchema: input.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) =>
      runTool(async () => {
        const actor = await scopedActor(ctx, args.orgId, 'work:write');
        if (args.action === 'begin') {
          const parsed = UploadBegin.safeParse(args);
          if (!parsed.success) throw new ValidationError(parsed.error);
          return jsonResult(await beginUpload(args.orgId, actor.actorId, parsed.data));
        }
        const id = z.string().min(1).safeParse(args.uploadId);
        if (!id.success) throw new ValidationError(id.error);
        if (args.action === 'cancel') {
          await cancelUpload(args.orgId, actor.actorId, id.data);
          return jsonResult({ removed: true });
        }
        const result =
          args.action === 'complete'
            ? await completeUpload(args.orgId, actor.actorId, id.data)
            : await readUpload(args.orgId, actor.actorId, id.data);
        return jsonResult(UploadSessionOut.parse(result));
      }),
  );
}
