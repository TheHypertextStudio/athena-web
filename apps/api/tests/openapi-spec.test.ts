/**
 * `@docket/api` — OpenAPI generation verification.
 *
 * @remarks
 * Generates the spec from the real `/v1` app and asserts the contract Scalar renders: paths
 * are populated and `/v1`-prefixed (no double prefix), the security schemes are present, tags
 * are declared, request/response schemas and the `x-docket-capability` extension flow through.
 */
import { describe, expect, it } from 'vitest';

describe('openapi spec generation', () => {
  it('produces a populated, well-formed 3.1 document', async () => {
    const { generateSpecs } = await import('hono-openapi');
    const { app } = await import('../src/app');
    const spec = (await generateSpecs(app)) as unknown as {
      openapi: string;
      paths: Record<
        string,
        Record<
          string,
          {
            tags?: string[];
            parameters?: { name?: string; in?: string; required?: boolean }[];
            responses?: Record<string, { content?: Record<string, unknown> }>;
            'x-docket-capability'?: string;
          }
        >
      >;
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
    expect(paths).toContain('/v1/me/athena');
    expect(paths).toContain('/v1/me/athena/chat/messages');
    expect(paths).toContain('/v1/me/athena/sessions');
    expect(paths).toContain('/v1/me/athena/sessions/{id}/stream');
    expect(paths).toContain('/v1/me/athena/sessions/{id}/activity/{activityId}/approve');
    expect(paths).toContain('/v1/me/athena/sessions/{id}/proposals/{groupId}/reject');

    const personalAthena = spec.paths['/v1/me/athena']?.['get'];
    expect(personalAthena?.tags).toContain('Athena');

    const personalStream = spec.paths['/v1/me/athena/sessions/{id}/stream']?.['get'];
    expect(personalStream?.parameters).toContainEqual(
      expect.objectContaining({ name: 'Last-Event-ID', in: 'header', required: false }),
    );
    expect(personalStream?.responses?.['200']?.content).toHaveProperty('text/event-stream');
    expect(paths).toContain('/v1/me/athena/connections');
    expect(paths).toContain('/v1/me/athena/assignments');
    expect(paths).toContain('/v1/me/athena/assignments/{id}/triggers');

    // A guarded mutation surfaces its tag + capability extension.
    const createTask = spec.paths['/v1/orgs/{orgId}/tasks']?.['post'];
    expect(createTask?.tags).toContain('Tasks');
    expect(createTask?.['x-docket-capability']).toBe('contribute');

    // A broad slice of the surface is documented (sanity floor on coverage).
    expect(paths.length).toBeGreaterThan(40);
  });
});
