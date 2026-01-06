/**
 * Storage service types.
 *
 * @packageDocumentation
 */

/**
 * Supported storage providers.
 */
export type StorageProvider = 'local' | 's3' | 'gcs' | 'azure' | 'database';

/**
 * Storage provider configuration.
 */
export interface StorageProviderConfig {
  provider: StorageProvider;

  // Local filesystem
  localPath?: string;

  // S3/S3-compatible
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Endpoint?: string; // For S3-compatible services like MinIO

  // Google Cloud Storage
  gcsBucket?: string;
  gcsProjectId?: string;
  gcsKeyFilename?: string;

  // Azure Blob Storage
  azureConnectionString?: string;
  azureContainerName?: string;

  // Common
  publicUrlBase?: string;
  maxFileSize?: number; // bytes
  allowedMimeTypes?: string[];
}

/**
 * Upload options.
 */
export interface UploadOptions {
  /**
   * User ID who owns the file.
   */
  userId: string;

  /**
   * Original filename.
   */
  filename: string;

  /**
   * MIME type.
   */
  mimeType: string;

  /**
   * Optional entity to attach to.
   */
  entityType?: 'task' | 'project' | 'event' | 'moment';
  entityId?: string;

  /**
   * Custom storage path prefix.
   */
  pathPrefix?: string;

  /**
   * Make file publicly accessible.
   */
  isPublic?: boolean;

  /**
   * Additional metadata.
   */
  metadata?: Record<string, string>;
}

/**
 * Upload result.
 */
export interface UploadResult {
  /**
   * Unique attachment ID.
   */
  id: string;

  /**
   * Storage key/path.
   */
  storageKey: string;

  /**
   * Full storage path.
   */
  storagePath: string;

  /**
   * Public URL if available.
   */
  publicUrl?: string;

  /**
   * File size in bytes.
   */
  size: number;

  /**
   * SHA-256 checksum.
   */
  checksum: string;

  /**
   * Storage provider used.
   */
  provider: StorageProvider;
}

/**
 * File info returned when reading.
 */
export interface FileInfo {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  checksum?: string;
  publicUrl?: string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  createdAt: Date;
}

/**
 * Signed URL options.
 */
export interface SignedUrlOptions {
  /**
   * Expiration time in seconds.
   */
  expiresIn: number;

  /**
   * Content disposition (inline or attachment).
   */
  contentDisposition?: 'inline' | 'attachment';

  /**
   * Custom filename for download.
   */
  downloadFilename?: string;
}

/**
 * Storage provider interface.
 */
export interface StorageProviderInterface {
  /**
   * Provider name.
   */
  readonly name: StorageProvider;

  /**
   * Check if provider is configured.
   */
  isConfigured(): boolean;

  /**
   * Upload a file.
   */
  upload(
    stream: ReadableStream<Uint8Array> | Uint8Array | Buffer,
    key: string,
    mimeType: string,
    options?: { isPublic?: boolean; metadata?: Record<string, string> },
  ): Promise<{ url?: string; size: number }>;

  /**
   * Download a file.
   */
  download(key: string): Promise<ReadableStream<Uint8Array>>;

  /**
   * Delete a file.
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get a signed URL for temporary access.
   */
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>;

  /**
   * Get the public URL for a file (if public).
   */
  getPublicUrl(key: string): string | null;

  /**
   * List files in a directory/prefix.
   */
  list(
    prefix: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<{
    files: { key: string; size: number; lastModified: Date }[];
    cursor?: string;
  }>;
}

/**
 * Image processing options.
 */
export interface ImageProcessingOptions {
  /**
   * Generate thumbnail.
   */
  generateThumbnail?: boolean;

  /**
   * Thumbnail width.
   */
  thumbnailWidth?: number;

  /**
   * Thumbnail height.
   */
  thumbnailHeight?: number;

  /**
   * Extract dimensions.
   */
  extractDimensions?: boolean;
}
