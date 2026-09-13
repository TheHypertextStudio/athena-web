import { NotionProviderClient } from '../../src/notion';
import type { ProviderHttp } from '../../src/provider-http';
import { TASKS_TRACKER_DATA_SOURCE, TASKS_TRACKER_PROPERTIES } from './notion-fixtures';

/** One request the double recorded. */
export interface RecordedCall {
  readonly method: 'get' | 'post' | 'patch';
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * A `ProviderHttp` double that records every call and answers from a per-test router.
 *
 * @remarks
 * Mirrors the Gmail suite's `RecordingHttp` so the Notion client is exercised through exactly the
 * seam the real connector uses — request building and response mapping are covered, only the
 * socket is replaced.
 */
export class RecordingHttp {
  readonly calls: RecordedCall[] = [];
  get: (path: string) => unknown = () => ({});
  post: (path: string, body: unknown) => unknown = () => ({});
  patch: (path: string, body: unknown) => unknown = () => ({});

  async getJson<T = unknown>(path: string, headers?: Record<string, string>): Promise<T> {
    this.calls.push({ method: 'get', path, ...(headers ? { headers } : {}) });
    return this.get(path) as T;
  }
  async postJson<T = unknown>(
    path: string,
    body: unknown,
    _auth?: 'bearer' | 'raw',
    headers?: Record<string, string>,
  ): Promise<T> {
    this.calls.push({ method: 'post', path, body, ...(headers ? { headers } : {}) });
    return this.post(path, body) as T;
  }
  async patchJson<T = unknown>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    this.calls.push({ method: 'patch', path, body, ...(headers ? { headers } : {}) });
    return this.patch(path, body) as T;
  }
}

/** Build a Notion client over a recording HTTP double. */
export function notion(http: RecordingHttp): NotionProviderClient {
  return new NotionProviderClient(http as unknown as ProviderHttp);
}

/** The `GET /data_sources/{id}` payload for the Tasks Tracker fixture. */
export const trackerSchemaPayload = {
  object: 'data_source',
  id: TASKS_TRACKER_DATA_SOURCE,
  title: [{ type: 'text', plain_text: 'Tasks Tracker' }],
  properties: TASKS_TRACKER_PROPERTIES,
};
