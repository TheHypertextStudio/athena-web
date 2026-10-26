import { createHash } from 'node:crypto';
import { z } from 'zod';
import { WorkResourceSubjectType } from '@docket/work/attachment-contract';
import { ValidationError } from '../error';
import {
  AttachResourceInput,
  ResourceWriteOutput,
  UploadResourceInput,
} from '../contracts/resource-write';
import { authorizeResourceSubject } from '../content/resource-subject';
import {
  attachedMaterial,
  uploadMaterial,
  type ResourceMaterial,
} from '../content/resource-write-input';
import { persistResourceWrite } from '../content/resource-write-receipt';
import { summarizeLibraryResource } from '../content/library-source';
import type { McpActor, McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { jsonResult, runTool, scopedActor } from './result';

const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
type WriteInput = z.infer<typeof UploadResourceInput> | z.infer<typeof AttachResourceInput>;

// Keep the advertised transport shape compact for local-model toolboxes. The complete domain
// schemas below still validate every bound and filename/MIME constraint before any allocation.
const transportTarget = z.object({
  orgId: z.string(),
  subjectType: WorkResourceSubjectType,
  subjectId: z.string(),
  requestId: z.string(),
  title: z.string().optional(),
});
const uploadTransport = transportTarget.extend({
  fileName: z.string(),
  mimeType: z.string().optional(),
  contentBase64: UploadResourceInput.shape.contentBase64,
});
const attachTransport = transportTarget.extend({
  resource: z.object({ kind: z.enum(['external_resource', 'attachment']), id: z.string() }),
});

function validated<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error);
  return result.data;
}

async function write(
  ctx: McpContext,
  input: WriteInput,
  prepare: (actor: McpActor) => Promise<ResourceMaterial> | ResourceMaterial,
) {
  const actor = await scopedActor(ctx, input.orgId, 'work:write');
  const subject = { ...actor, subjectType: input.subjectType, subjectId: input.subjectId };
  await authorizeResourceSubject(subject, 'contribute');
  const material = await prepare(actor);
  const result = await persistResourceWrite(
    {
      ...subject,
      requestId: input.requestId,
      namespace: ctx.clientId ? `oauth:${ctx.clientId}` : `internal:${ctx.principal.kind}`,
      requestHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    },
    material,
  );
  return jsonResult({
    resource: summarizeLibraryResource(
      { orgId: input.orgId, kind: 'attachment', id: result.row.id },
      result.row,
      [],
    ),
    replayed: result.replayed,
    disposition: material.disposition,
    ...(material.source ? { source: material.source } : {}),
  });
}

/** Register bounded upload and same-workspace Library reuse with destination-owned file lifetimes. */
export function registerResourceWriteTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'upload_resource',
    {
      title: 'Upload a resource',
      description:
        'Upload a file to work (all four types). Destination viewers can read it. Max 4 MiB, canonical base64; reuse requestId for identical retries. Returns safe metadata and read URIs.',
      inputSchema: uploadTransport.shape,
      outputSchema: ResourceWriteOutput.shape,
      annotations,
    },
    (args) =>
      runTool(() => {
        const input = validated(UploadResourceInput, args);
        return write(ctx, input, () => uploadMaterial(input));
      }),
  );
  server.registerTool(
    'attach_resource',
    {
      title: 'Attach a Library resource',
      description:
        'Attach readable same-workspace Library material to work. Files are independent copies shared with destination viewers and survive source removal/revocation; links stay canonical. Reuse requestId for identical retries.',
      inputSchema: attachTransport.shape,
      outputSchema: ResourceWriteOutput.shape,
      annotations,
    },
    (args) =>
      runTool(() => {
        const input = validated(AttachResourceInput, args);
        return write(ctx, input, (actor) =>
          attachedMaterial(
            ctx.principal.kind === 'user'
              ? { kind: 'user', userId: ctx.principal.userId }
              : {
                  kind: 'agent',
                  actorId: ctx.principal.agentActorId,
                  organizationId: ctx.principal.orgId,
                },
            input,
            actor.actorId,
          ),
        );
      }),
  );
}
