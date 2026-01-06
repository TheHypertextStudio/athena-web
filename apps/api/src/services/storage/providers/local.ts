/**
 * Local filesystem storage provider.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import type { StorageProviderInterface, SignedUrlOptions } from '../types.js';

/**
 * Local storage provider configuration.
 */
export interface LocalStorageConfig {
  /**
   * Base path for file storage.
   */
  basePath: string;

  /**
   * Public URL base for serving files.
   */
  publicUrlBase?: string;
}

/**
 * Local filesystem storage provider.
 */
export class LocalStorageProvider implements StorageProviderInterface {
  readonly name = 'local' as const;
  private readonly config: LocalStorageConfig;

  constructor(config: LocalStorageConfig) {
    this.config = config;

    // Ensure base directory exists
    if (!fs.existsSync(this.config.basePath)) {
      fs.mkdirSync(this.config.basePath, { recursive: true });
    }
  }

  isConfigured(): boolean {
    return !!this.config.basePath;
  }

  async upload(
    stream: ReadableStream<Uint8Array> | Uint8Array | Buffer,
    key: string,
    _mimeType: string,
    options?: { isPublic?: boolean; metadata?: Record<string, string> },
  ): Promise<{ url?: string; size: number }> {
    const filePath = this.getFilePath(key);
    const dir = path.dirname(filePath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file
    let size: number;

    if (stream instanceof Uint8Array || Buffer.isBuffer(stream)) {
      fs.writeFileSync(filePath, stream);
      size = stream.length;
    } else {
      // Handle ReadableStream
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();

      let reading = true;
      while (reading) {
        const { done, value } = await reader.read();
        if (done) {
          reading = false;
        } else {
          chunks.push(value);
        }
      }

      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buffer);
      size = buffer.length;
    }

    // Store metadata if provided
    if (options?.metadata) {
      const metaPath = `${filePath}.meta.json`;
      fs.writeFileSync(metaPath, JSON.stringify(options.metadata));
    }

    const url = options?.isPublic ? this.getPublicUrl(key) : undefined;

    return { url: url ?? undefined, size };
  }

  async download(key: string): Promise<ReadableStream<Uint8Array>> {
    const filePath = this.getFilePath(key);

    try {
      await fsPromises.access(filePath);
    } catch {
      throw new Error(`File not found: ${key}`);
    }

    const nodeStream = fs.createReadStream(filePath);

    // Convert Node.js stream to Web ReadableStream
    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer | string) => {
          if (typeof chunk === 'string') {
            controller.enqueue(new TextEncoder().encode(chunk));
          } else {
            controller.enqueue(new Uint8Array(chunk));
          }
        });
        nodeStream.on('end', () => {
          controller.close();
        });
        nodeStream.on('error', (err) => {
          controller.error(err);
        });
      },
      cancel() {
        nodeStream.destroy();
      },
    });
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);

    try {
      await fsPromises.unlink(filePath);
    } catch {
      // File doesn't exist, ignore
    }

    // Also delete metadata if exists
    const metaPath = `${filePath}.meta.json`;
    try {
      await fsPromises.unlink(metaPath);
    } catch {
      // Metadata file doesn't exist, ignore
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getSignedUrl(_key: string, _options: SignedUrlOptions): Promise<string> {
    // Local storage doesn't support signed URLs
    // In a real app, you might generate a temporary token
    return Promise.reject(new Error('Signed URLs not supported for local storage'));
  }

  getPublicUrl(key: string): string | null {
    if (!this.config.publicUrlBase) {
      return null;
    }
    return `${this.config.publicUrlBase}/${key}`;
  }

  async list(
    prefix: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<{
    files: { key: string; size: number; lastModified: Date }[];
    cursor?: string;
  }> {
    const dirPath = path.join(this.config.basePath, prefix);

    try {
      await fsPromises.access(dirPath);
    } catch {
      return { files: [] };
    }

    const files: { key: string; size: number; lastModified: Date }[] = [];
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    let skip = 0;
    if (options?.cursor) {
      skip = parseInt(options.cursor, 10);
    }

    let count = 0;
    for (const entry of entries.slice(skip)) {
      if (options?.limit && count >= options.limit) {
        return {
          files,
          cursor: String(skip + count),
        };
      }

      if (entry.isFile() && !entry.name.endsWith('.meta.json')) {
        const filePath = path.join(dirPath, entry.name);
        const stats = await fsPromises.stat(filePath);
        files.push({
          key: path.join(prefix, entry.name),
          size: stats.size,
          lastModified: stats.mtime,
        });
        count++;
      }
    }

    return { files };
  }

  private getFilePath(key: string): string {
    // Sanitize key to prevent directory traversal
    const sanitized = key.replace(/\.\./g, '').replace(/^\//, '');
    return path.join(this.config.basePath, sanitized);
  }
}
