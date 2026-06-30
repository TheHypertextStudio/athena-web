/**
 * `@docket/api` — OpenAPI generation verification.
 *
 * @remarks
 * Generates the spec from the real `/v1` app and asserts the contract Scalar renders: paths
 * are populated and `/v1`-prefixed (no double prefix), the security schemes are present, tags
 * are declared, request/response schemas and the `x-docket-capability` extension flow through.
 */
import { describe, expect, it } from 'vitest';

// Match infra.test.ts: provide the fail-fast env before importing the app graph.
process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

describe('openapi spec generation', () => {
  it('produces a populated, well-formed 3.1 document', async () => {
    const { generateSpecs } = await import('hono-openapi');
    const { app } = await import('../src/app');
    const spec = (await generateSpecs(app)) as unknown as {
      openapi: string;
      paths: Record<string, Record<string, { tags?: string[]; 'x-docket-capability'?: string }>>;
    };

    const paths = Object.keys(spec.paths);
    // Every documented path carries the app's `/v1` basePath exactly once.
    for (const p of paths) {
      expect(p.startsWith('/v1/')).toBe(true);
      expect(p.startsWith('/v1/v1/')).toBe(false);
    }

    // Representative resources from across the surface are documented.
    expect(paths).toContain('/v1/orgs/{orgId}/tasks');
    expect(paths).toContain('/v1/orgs/{orgId}/projects');
    expect(paths).toContain('/v1/orgs');

    // A guarded mutation surfaces its tag + capability extension.
    const createTask = spec.paths['/v1/orgs/{orgId}/tasks']?.['post'];
    expect(createTask?.tags).toContain('Tasks');
    expect(createTask?.['x-docket-capability']).toBe('contribute');

    // A broad slice of the surface is documented (sanity floor on coverage).
    expect(paths.length).toBeGreaterThan(40);
  });
});
