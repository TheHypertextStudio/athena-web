/** Receive binary multipart bytes using a short-lived token created through MCP. */
import { DeliverableOut } from '@docket/work/attachment-contract';
import { Hono } from 'hono';
import { z } from 'zod';

import { MAX_ATTACHMENT_BYTES } from '../content/attachment-file';
import {
  completeDeliverableUploadSession,
  loadDeliverableUploadSession,
} from '../content/deliverables';
import type { AppEnv } from '../context';
import type { ApiOperationContract } from '../lib/api-operation-contract';
import { created, resourceUrl } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zForm, zParam } from '../lib/validate';

interface UploadedFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const uploadForm = z.object({
  file: z
    .custom<UploadedFile>((value) => value instanceof File, { message: 'A file is required.' })
    .refine((file) => file.size > 0, { message: 'The file is empty.' })
    .refine((file) => file.size <= MAX_ATTACHMENT_BYTES, {
      message: 'Files must be no larger than 4 MB.',
    }),
});

const uploadParam = z.object({ sessionId: z.string().min(1) });

const uploadContract = {
  operationId: 'uploadDeliverableBytes',
  tag: 'Comments',
  summary: 'Upload deliverable bytes',
  narrative: {
    purpose: 'Stream one local file into a private deliverable draft created by an agent.',
    behavior: [
      'Send multipart form data with one `file` part and the `X-Docket-Upload-Token` returned by `create_deliverable_upload_session`.',
      'The token is scoped to one file, expires after 15 minutes, and can retry only with the same bytes and metadata.',
      'The response contains the private draft ID to include when posting a comment or update.',
    ],
    constraints: ['The file must be non-empty and at most 4 MB.'],
  },
  access: { kind: 'capability-token', header: 'X-Docket-Upload-Token' },
  requestBody: {
    description: 'Multipart form with a single file field.',
    examples: {
      image: {
        summary: 'Upload an image deliverable',
        value: {
          file: { filename: 'proof.png', contentType: 'image/png', contents: '(binary data)' },
        },
      },
    },
  },
  success: [
    {
      kind: 'json',
      status: 201,
      schema: DeliverableOut,
      description: 'The private draft deliverable created or recovered by this upload session.',
      location: 'resource',
    },
  ],
  errors: [
    'unauthorized',
    'not_found',
    'validation_error',
    'conflict',
    'not_acceptable',
    'payload_too_large',
    'unsupported_media_type',
    'internal',
  ],
  conditionalRead: false,
  conditionalWrite: false,
  idempotency: false,
  related: [],
} satisfies ApiOperationContract;

/** A bearer-token-only upload route; the token itself is checked against a hashed DB record. */
export const deliverableUploadRoutes = new Hono<AppEnv>().post(
  '/:sessionId',
  apiDoc(uploadContract),
  zParam(uploadParam),
  zForm(uploadForm),
  async (c) => {
    const session = await loadDeliverableUploadSession(
      c.req.valid('param').sessionId,
      c.req.header('X-Docket-Upload-Token') ?? '',
    );
    const { file } = c.req.valid('form');
    const uploaded = await completeDeliverableUploadSession(session, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: session.fileName,
      type: session.mimeType,
    });
    return created(c, DeliverableOut, uploaded, resourceUrl(uploaded.downloadUrl));
  },
);
