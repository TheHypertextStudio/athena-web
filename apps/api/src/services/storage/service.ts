/**
 * Storage service for file uploads.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { db } from '../../db/index.js';
import {
  attachments,
  taskAttachments,
  projectAttachments,
  eventAttachments,
} from '../../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type {
  StorageProviderInterface,
  UploadOptions,
  UploadResult,
  FileInfo,
  SignedUrlOptions,
  StorageProviderConfig,
} from './types.js';
import { LocalStorageProvider } from './providers/local.js';
import { S3StorageProvider } from './providers/s3.js';
import { env } from '../../lib/env.js';

/**
 * Allowed MIME types by category.
 */
export const ALLOWED_MIME_TYPES = {
  images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  documents: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/markdown',
    'text/csv',
  ],
  archives: ['application/zip', 'application/x-gzip', 'application/x-tar'],
};

/**
 * Default max file size (50MB).
 */
export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Storage service for managing file uploads.
 */
export class StorageService {
  private readonly provider: StorageProviderInterface;
  private readonly maxFileSize: number;
  private readonly allowedMimeTypes: string[];

  constructor(config: StorageProviderConfig) {
    this.maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.allowedMimeTypes = config.allowedMimeTypes ?? [
      ...ALLOWED_MIME_TYPES.images,
      ...ALLOWED_MIME_TYPES.documents,
      ...ALLOWED_MIME_TYPES.archives,
    ];

    // Initialize storage provider
    switch (config.provider) {
      case 's3':
        if (
          !config.s3Bucket ||
          !config.s3Region ||
          !config.s3AccessKeyId ||
          !config.s3SecretAccessKey
        ) {
          throw new Error('S3 configuration incomplete');
        }
        this.provider = new S3StorageProvider({
          bucket: config.s3Bucket,
          region: config.s3Region,
          accessKeyId: config.s3AccessKeyId,
          secretAccessKey: config.s3SecretAccessKey,
          endpoint: config.s3Endpoint,
          publicUrlBase: config.publicUrlBase,
        });
        break;
      case 'local':
      default:
        this.provider = new LocalStorageProvider({
          basePath: config.localPath ?? './uploads',
          publicUrlBase: config.publicUrlBase,
        });
        break;
    }
  }

  /**
   * Upload a file.
   */
  async upload(
    file: File | Blob | ReadableStream<Uint8Array> | Uint8Array | Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    // Get file data
    let data: Uint8Array;
    let filename = options.filename;
    let mimeType = options.mimeType;

    if (file instanceof File) {
      filename = file.name;
      mimeType = file.type;
      data = new Uint8Array(await file.arrayBuffer());
    } else if (file instanceof Blob) {
      data = new Uint8Array(await file.arrayBuffer());
    } else if (file instanceof ReadableStream) {
      const chunks: Uint8Array[] = [];
      const reader = file.getReader();
      let reading = true;
      while (reading) {
        const { done, value } = await reader.read();
        if (done) {
          reading = false;
        } else {
          chunks.push(value);
        }
      }
      data = Buffer.concat(chunks);
    } else {
      data = file;
    }

    // Validate file size
    if (data.length > this.maxFileSize) {
      throw new Error(`File size exceeds maximum of ${String(this.maxFileSize)} bytes`);
    }

    // Validate MIME type
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new Error(`MIME type ${mimeType} not allowed`);
    }

    // Generate unique ID and storage key
    const id = crypto.randomUUID();
    const extension = this.getExtension(filename);
    const storageKey = this.generateStorageKey(options.userId, id, extension, options.pathPrefix);

    // Calculate checksum
    const checksum = this.calculateChecksum(data);

    // Upload to storage provider
    const result = await this.provider.upload(data, storageKey, mimeType, {
      isPublic: options.isPublic,
      metadata: options.metadata,
    });

    // Store attachment record
    const now = new Date();
    await db.insert(attachments).values({
      id,
      userId: options.userId,
      filename: storageKey,
      originalFilename: filename,
      mimeType,
      size: data.length,
      checksum,
      storageProvider: this.provider.name,
      storagePath: storageKey,
      storageKey,
      publicUrl: result.url ?? null,
      status: 'ready',
      entityType: options.entityType ?? null,
      entityId: options.entityId ?? null,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Create entity association if specified
    if (options.entityType && options.entityId) {
      await this.associateWithEntity(id, options.entityType, options.entityId);
    }

    return {
      id,
      storageKey,
      storagePath: storageKey,
      publicUrl: result.url,
      size: data.length,
      checksum,
      provider: this.provider.name,
    };
  }

  /**
   * Download a file.
   */
  async download(
    attachmentId: string,
    userId: string,
  ): Promise<{
    stream: ReadableStream<Uint8Array>;
    info: FileInfo;
  }> {
    const attachment = await db.query.attachments.findFirst({
      where: and(
        eq(attachments.id, attachmentId),
        eq(attachments.userId, userId),
        isNull(attachments.deletedAt),
      ),
    });

    if (!attachment) {
      throw new Error('Attachment not found');
    }

    const stream = await this.provider.download(attachment.storageKey ?? attachment.storagePath);

    return {
      stream,
      info: this.toFileInfo(attachment),
    };
  }

  /**
   * Delete an attachment.
   */
  async delete(attachmentId: string, userId: string): Promise<boolean> {
    const attachment = await db.query.attachments.findFirst({
      where: and(
        eq(attachments.id, attachmentId),
        eq(attachments.userId, userId),
        isNull(attachments.deletedAt),
      ),
    });

    if (!attachment) {
      return false;
    }

    // Soft delete the attachment
    await db
      .update(attachments)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(attachments.id, attachmentId));

    // Optionally delete from storage (or keep for recovery)
    // await this.provider.delete(attachment.storageKey ?? attachment.storagePath);

    return true;
  }

  /**
   * Get attachment info.
   */
  async getInfo(attachmentId: string, userId: string): Promise<FileInfo | null> {
    const attachment = await db.query.attachments.findFirst({
      where: and(
        eq(attachments.id, attachmentId),
        eq(attachments.userId, userId),
        isNull(attachments.deletedAt),
      ),
    });

    if (!attachment) {
      return null;
    }

    return this.toFileInfo(attachment);
  }

  /**
   * List attachments for an entity.
   */
  async listForEntity(
    entityType: 'task' | 'project' | 'event',
    entityId: string,
    userId: string,
  ): Promise<FileInfo[]> {
    const results = await db.query.attachments.findMany({
      where: and(
        eq(attachments.userId, userId),
        eq(attachments.entityType, entityType),
        eq(attachments.entityId, entityId),
        isNull(attachments.deletedAt),
      ),
    });

    return results.map((a) => this.toFileInfo(a));
  }

  /**
   * Get a signed URL for temporary access.
   */
  async getSignedUrl(
    attachmentId: string,
    userId: string,
    options: SignedUrlOptions,
  ): Promise<string> {
    const attachment = await db.query.attachments.findFirst({
      where: and(
        eq(attachments.id, attachmentId),
        eq(attachments.userId, userId),
        isNull(attachments.deletedAt),
      ),
    });

    if (!attachment) {
      throw new Error('Attachment not found');
    }

    return this.provider.getSignedUrl(attachment.storageKey ?? attachment.storagePath, {
      ...options,
      downloadFilename: attachment.originalFilename,
    });
  }

  /**
   * Associate attachment with an entity.
   */
  private async associateWithEntity(
    attachmentId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date();

    switch (entityType) {
      case 'task':
        await db.insert(taskAttachments).values({
          id,
          taskId: entityId,
          attachmentId,
          createdAt: now,
        });
        break;
      case 'project':
        await db.insert(projectAttachments).values({
          id,
          projectId: entityId,
          attachmentId,
          createdAt: now,
        });
        break;
      case 'event':
        await db.insert(eventAttachments).values({
          id,
          eventId: entityId,
          attachmentId,
          createdAt: now,
        });
        break;
    }
  }

  private generateStorageKey(
    userId: string,
    id: string,
    extension: string,
    prefix?: string,
  ): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    const parts = [prefix ?? 'uploads', userId, String(year), month, `${id}${extension}`];

    return parts.filter(Boolean).join('/');
  }

  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filename.slice(lastDot).toLowerCase();
  }

  private calculateChecksum(data: Uint8Array): string {
    const hash = crypto.createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }

  private toFileInfo(attachment: typeof attachments.$inferSelect): FileInfo {
    return {
      id: attachment.id,
      filename: attachment.filename,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      checksum: attachment.checksum ?? undefined,
      publicUrl: attachment.publicUrl ?? undefined,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
      thumbnailUrl: attachment.thumbnailUrl ?? undefined,
      createdAt: attachment.createdAt,
    };
  }
}

/**
 * Create storage service from environment.
 */
export function createStorageService(): StorageService {
  const provider = env.STORAGE_PROVIDER ?? 'local';

  const config: StorageProviderConfig = {
    provider,
    localPath: env.STORAGE_LOCAL_PATH ?? './uploads',
    publicUrlBase: env.STORAGE_PUBLIC_URL_BASE,
    maxFileSize: env.STORAGE_MAX_FILE_SIZE,
  };

  // Use validated S3 config object if available
  if (env.s3Storage) {
    config.s3Bucket = env.s3Storage.bucket;
    config.s3Region = env.s3Storage.region;
    config.s3AccessKeyId = env.s3Storage.accessKeyId;
    config.s3SecretAccessKey = env.s3Storage.secretAccessKey;
    config.s3Endpoint = env.s3Storage.endpoint;
  }

  return new StorageService(config);
}

// Singleton instance
let storageServiceInstance: StorageService | null = null;

/**
 * Get the shared storage service instance.
 */
export function getStorageService(): StorageService {
  storageServiceInstance ??= createStorageService();
  return storageServiceInstance;
}
