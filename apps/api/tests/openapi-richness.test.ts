/**
 * `@docket/api` — OpenAPI documentation richness gates.
 *
 * @remarks
 * Guards the "the API reference IS the product documentation" bar: a comprehensive product
 * overview, per-resource narratives, an operation-level description on (nearly) every route,
 * truthful per-operation security, and field-level descriptions on DTO schema properties.
 */
import { describe, expect, it } from 'vitest';

describe('openapi documentation richness', () => {
  it('serves an exhaustive, truthful, self-documenting spec', async () => {
    const { Hono } = await import('hono');
    const { registerOpenapi } = await import('../src/openapi');
    const { app, adminApp } = await import('../src/app');
    const server = new Hono();
    registerOpenapi(server as never, app, adminApp);
    const doc = (await (await server.request('/v1/openapi.json')).json()) as {
      info: { description: string };
      tags: { name: string; description?: string }[];
      security?: unknown[];
      paths: Record<
        string,
        Record<string, { description?: string; security?: unknown[]; tags?: string[] }>
      >;
    };

    // Product overview is a substantial narrative.
    expect(doc.info.description.length).toBeGreaterThan(2000);

    // Every tag carries a real narrative (not a stub one-liner).
    for (const tag of doc.tags) expect((tag.description ?? '').length).toBeGreaterThan(80);

    // Walk all operations.
    interface Op {
      description?: string;
      security?: unknown[];
      tags?: string[];
    }
    const ops: { method: string; path: string; op: Op }[] = [];
    for (const path of Object.keys(doc.paths)) {
      const item = doc.paths[path];
      if (!item) continue;
      for (const method of Object.keys(item)) {
        const op = item[method];
        if (op) ops.push({ method, path, op });
      }
    }

    // (a) Operation-level descriptions on ≥95% of operations (rich prose, not just a summary).
    const described = ops.filter((o) => (o.op.description ?? '').length > 60);
    expect(described.length / ops.length).toBeGreaterThanOrEqual(0.95);

    // (b) Security is truthful: every operation requires bearer auth except the public config.
    const publicOps = ops.filter((o) => {
      const sec = o.op.security ?? doc.security;
      return !sec || (Array.isArray(sec) && sec.length === 0);
    });
    expect(publicOps.map((o) => `${o.method.toUpperCase()} ${o.path}`)).toEqual(['GET /v1/config']);
  });

  it('documents DTO fields with descriptions', async () => {
    // Field-level descriptions live on the Zod schemas; verify a representative sample has a
    // description on every property (these flow into the spec's component schemas).
    const t = await import('@docket/types');
    const sample = ['TaskOut', 'OrgOut', 'ProjectOut', 'CommentOut', 'AgentSessionOut'] as const;
    for (const name of sample) {
      const schema = (t as Record<string, unknown>)[name];
      const json = (await import('zod')).z.toJSONSchema(schema as never, { io: 'output' }) as {
        properties?: Record<string, { description?: string }>;
      };
      const props = Object.entries(json.properties ?? {});
      expect(props.length).toBeGreaterThan(0);
      const withDesc = props.filter(([, v]) => (v.description ?? '').length > 0);
      // Every property of these core output DTOs is documented.
      expect(withDesc.length).toBe(props.length);
    }
  });
});
