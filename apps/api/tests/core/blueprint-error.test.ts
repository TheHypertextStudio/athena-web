import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { BlueprintError } from '@docket/work/blueprints';
import { onError } from '../../src/error';
import { Problem, publicProblemTitle } from '../../src/contracts/errors';
import { runTool } from '../../src/mcp/result';

describe('blueprint refusals at the API boundary', () => {
  it('keeps the actionable blueprint code in MCP without exposing exception details', async () => {
    const result = await runTool(async () => {
      throw new BlueprintError('blueprint_destination_required', 'PRIVATE BODY: inaccessible team');
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('blueprint_destination_required');
    expect(JSON.stringify(result.content)).not.toContain('PRIVATE BODY');
  });
  it.each([
    'blueprint_limit',
    'blueprint_loop',
    'blueprint_prerequisite',
    'blueprint_destination_required',
    'blueprint_invalid',
    'blueprint_incomplete_capture',
  ] as const)(
    'renders %s as actionable owned copy without private exception text',
    async (code) => {
      const app = new Hono()
        .get('/', () => {
          throw new BlueprintError(code, 'PRIVATE BODY: provider/database detail');
        })
        .onError(onError);
      const response = await app.request('/');
      expect(response.status).toBe(422);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      const body = await response.json();
      expect(body).toMatchObject({ code, status: 422, title: publicProblemTitle(code) });
      expect(JSON.stringify(body)).not.toContain('PRIVATE BODY');
      expect(Problem.safeParse(body).success).toBe(true);
    },
  );
});
