/**
 * Attachment route helpers.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { AttachmentEntityTypeSchema } from '@athena/types/openapi/attachments';

const uploadFormSchema = z.object({
  file: z.unknown(),
  entityType: AttachmentEntityTypeSchema.optional(),
  entityId: z.string().optional(),
  isPublic: z.string().optional(),
});

interface UploadFormData {
  file: File;
  entityType?: z.infer<typeof AttachmentEntityTypeSchema>;
  entityId?: string;
  isPublic: boolean;
}

type UploadFormParseResult =
  | { success: true; data: UploadFormData }
  | { success: false; error: 'missing_file' | 'invalid_payload' };

export function parseUploadFormData(formData: FormData): UploadFormParseResult {
  const parsed = uploadFormSchema.safeParse({
    file: formData.get('file'),
    entityType: formData.get('entityType') ?? undefined,
    entityId: formData.get('entityId') ?? undefined,
    isPublic: formData.get('isPublic') ?? undefined,
  });

  if (!parsed.success) {
    const missingFile = parsed.error.issues.some((issue) => issue.path[0] === 'file');
    return {
      success: false,
      error: missingFile ? 'missing_file' : 'invalid_payload',
    };
  }

  if (!(parsed.data.file instanceof File)) {
    return { success: false, error: 'missing_file' };
  }

  return {
    success: true,
    data: {
      file: parsed.data.file,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      isPublic: parsed.data.isPublic === 'true',
    },
  };
}
