/**
 * S3-compatible storage provider.
 *
 * Works with AWS S3, MinIO, DigitalOcean Spaces, Cloudflare R2, etc.
 *
 * @packageDocumentation
 */

import type { StorageProviderInterface, SignedUrlOptions } from '../types.js';

/**
 * S3 storage provider configuration.
 */
export interface S3StorageConfig {
  /**
   * S3 bucket name.
   */
  bucket: string;

  /**
   * AWS region.
   */
  region: string;

  /**
   * Access key ID.
   */
  accessKeyId: string;

  /**
   * Secret access key.
   */
  secretAccessKey: string;

  /**
   * Custom endpoint for S3-compatible services.
   */
  endpoint?: string;

  /**
   * Force path style (for MinIO, etc.).
   */
  forcePathStyle?: boolean;

  /**
   * Public URL base for CDN.
   */
  publicUrlBase?: string;
}

/**
 * S3 storage provider.
 */
export class S3StorageProvider implements StorageProviderInterface {
  readonly name = 's3' as const;
  private readonly config: S3StorageConfig;

  constructor(config: S3StorageConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!(
      this.config.bucket &&
      this.config.region &&
      this.config.accessKeyId &&
      this.config.secretAccessKey
    );
  }

  async upload(
    stream: ReadableStream<Uint8Array> | Uint8Array | Buffer,
    key: string,
    mimeType: string,
    options?: { isPublic?: boolean; metadata?: Record<string, string> },
  ): Promise<{ url?: string; size: number }> {
    // Convert stream to buffer if needed
    let body: Uint8Array;
    if (stream instanceof Uint8Array || Buffer.isBuffer(stream)) {
      body = stream;
    } else {
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
      body = Buffer.concat(chunks);
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Content-Length': String(body.length),
    };

    if (options?.isPublic) {
      headers['x-amz-acl'] = 'public-read';
    }

    // Add custom metadata
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${k}`] = v;
      }
    }

    const url = this.buildUrl(key);
    const signedHeaders = await this.signRequest('PUT', url, headers, body);

    const response = await fetch(url, {
      method: 'PUT',
      headers: signedHeaders,
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`S3 upload failed: ${error}`);
    }

    const publicUrl = options?.isPublic ? this.getPublicUrl(key) : undefined;

    return { url: publicUrl ?? undefined, size: body.length };
  }

  async download(key: string): Promise<ReadableStream<Uint8Array>> {
    const url = this.buildUrl(key);
    const headers = await this.signRequest('GET', url, {});

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`S3 download failed: ${String(response.status)}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    return response.body;
  }

  async delete(key: string): Promise<void> {
    const url = this.buildUrl(key);
    const headers = await this.signRequest('DELETE', url, {});

    const response = await fetch(url, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed: ${String(response.status)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const url = this.buildUrl(key);
    const headers = await this.signRequest('HEAD', url, {});

    const response = await fetch(url, {
      method: 'HEAD',
      headers,
    });

    return response.ok;
  }

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const url = new URL(this.buildUrl(key));

    // Add query parameters for presigned URL
    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Expires', String(options.expiresIn));
    url.searchParams.set('X-Amz-Date', new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''));
    url.searchParams.set(
      'X-Amz-Credential',
      `${this.config.accessKeyId}/${this.getCredentialScope()}`,
    );
    url.searchParams.set('X-Amz-SignedHeaders', 'host');

    if (options.contentDisposition) {
      const disposition =
        options.contentDisposition === 'attachment' && options.downloadFilename
          ? `attachment; filename="${options.downloadFilename}"`
          : options.contentDisposition;
      url.searchParams.set('response-content-disposition', disposition);
    }

    // Sign the URL
    const signature = await this.calculateSignature(
      'GET',
      url.pathname + url.search,
      { host: url.host },
      'UNSIGNED-PAYLOAD',
    );

    url.searchParams.set('X-Amz-Signature', signature);

    return url.toString();
  }

  getPublicUrl(key: string): string | null {
    if (this.config.publicUrlBase) {
      return `${this.config.publicUrlBase}/${key}`;
    }

    if (this.config.endpoint) {
      return `${this.config.endpoint}/${this.config.bucket}/${key}`;
    }

    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }

  async list(
    prefix: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<{
    files: { key: string; size: number; lastModified: Date }[];
    cursor?: string;
  }> {
    const url = new URL(this.buildBucketUrl());
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);

    if (options?.limit) {
      url.searchParams.set('max-keys', String(options.limit));
    }
    if (options?.cursor) {
      url.searchParams.set('continuation-token', options.cursor);
    }

    const headers = await this.signRequest('GET', url.toString(), {});

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`S3 list failed: ${String(response.status)}`);
    }

    const xml = await response.text();
    // Simple XML parsing for S3 ListObjectsV2 response
    const files = this.parseListResponse(xml);
    const nextCursor = this.extractContinuationToken(xml);

    return {
      files,
      cursor: nextCursor,
    };
  }

  private buildUrl(key: string): string {
    if (this.config.endpoint) {
      if (this.config.forcePathStyle) {
        return `${this.config.endpoint}/${this.config.bucket}/${key}`;
      }
      const endpoint = new URL(this.config.endpoint);
      return `${endpoint.protocol}//${this.config.bucket}.${endpoint.host}/${key}`;
    }
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }

  private buildBucketUrl(): string {
    if (this.config.endpoint) {
      if (this.config.forcePathStyle) {
        return `${this.config.endpoint}/${this.config.bucket}`;
      }
      const endpoint = new URL(this.config.endpoint);
      return `${endpoint.protocol}//${this.config.bucket}.${endpoint.host}`;
    }
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com`;
  }

  private async signRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Uint8Array,
  ): Promise<Record<string, string>> {
    const urlObj = new URL(url);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const signedHeaders: Record<string, string> = {
      ...headers,
      host: urlObj.host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': body ? await this.sha256(body) : 'UNSIGNED-PAYLOAD',
    };

    const signature = await this.calculateSignature(
      method,
      urlObj.pathname + urlObj.search,
      signedHeaders,
      body ? await this.sha256(body) : 'UNSIGNED-PAYLOAD',
    );

    const headerNames = Object.keys(signedHeaders)
      .map((h) => h.toLowerCase())
      .sort()
      .join(';');

    signedHeaders['Authorization'] = [
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${dateStamp}/${this.config.region}/s3/aws4_request`,
      `SignedHeaders=${headerNames}`,
      `Signature=${signature}`,
    ].join(', ');

    return signedHeaders;
  }

  private async calculateSignature(
    method: string,
    path: string,
    headers: Record<string, string>,
    payloadHash: string,
  ): Promise<string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    // Create canonical request
    const headerNames = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort();
    const canonicalHeaders = headerNames.map((h) => `${h}:${headers[h] ?? ''}`).join('\n');
    const signedHeaders = headerNames.join(';');

    const canonicalRequest = [
      method,
      path.split('?')[0],
      path.includes('?') ? path.split('?')[1] : '',
      canonicalHeaders + '\n',
      signedHeaders,
      payloadHash,
    ].join('\n');

    // Create string to sign
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await this.sha256(new TextEncoder().encode(canonicalRequest)),
    ].join('\n');

    // Calculate signature
    const kDate = await this.hmac(`AWS4${this.config.secretAccessKey}`, dateStamp);
    const kRegion = await this.hmac(kDate, this.config.region);
    const kService = await this.hmac(kRegion, 's3');
    const kSigning = await this.hmac(kService, 'aws4_request');
    const signature = await this.hmac(kSigning, stringToSign);

    return this.toHex(signature);
  }

  private getCredentialScope(): string {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `${dateStamp}/${this.config.region}/s3/aws4_request`;
  }

  private async sha256(data: Uint8Array | string): Promise<string> {
    const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return this.toHex(new Uint8Array(hash));
  }

  private async hmac(key: string | Uint8Array, data: string): Promise<Uint8Array> {
    const keyBuffer = typeof key === 'string' ? new TextEncoder().encode(key) : key;
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
    return new Uint8Array(signature);
  }

  private toHex(buffer: Uint8Array): string {
    return Array.from(buffer)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private parseListResponse(xml: string): { key: string; size: number; lastModified: Date }[] {
    const files: { key: string; size: number; lastModified: Date }[] = [];
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match;

    while ((match = contentsRegex.exec(xml)) !== null) {
      const content = match[1] ?? '';
      const keyMatch = /<Key>([^<]+)<\/Key>/.exec(content);
      const sizeMatch = /<Size>(\d+)<\/Size>/.exec(content);
      const modifiedMatch = /<LastModified>([^<]+)<\/LastModified>/.exec(content);

      if (keyMatch?.[1]) {
        files.push({
          key: keyMatch[1],
          size: sizeMatch?.[1] ? parseInt(sizeMatch[1], 10) : 0,
          lastModified: modifiedMatch?.[1] ? new Date(modifiedMatch[1]) : new Date(),
        });
      }
    }

    return files;
  }

  private extractContinuationToken(xml: string): string | undefined {
    const match = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
    return match?.[1];
  }
}
