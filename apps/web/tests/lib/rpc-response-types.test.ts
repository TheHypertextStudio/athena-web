import { describe, expect, expectTypeOf, it } from 'vitest';

import { type RpcResponse, unwrap } from '../../src/lib/query-core';

interface TaskResult {
  readonly target: 'task';
}

interface ProjectResult {
  readonly target: 'project';
}

function result<T>(body: T): RpcResponse<T> {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

describe('RPC response type inference', () => {
  it('unwraps discriminated response unions without erasing their variants', async () => {
    const call = (): Promise<RpcResponse<TaskResult> | RpcResponse<ProjectResult>> =>
      Promise.resolve(result<TaskResult>({ target: 'task' }));

    const body = unwrap(call, 'Could not read the saved view.');

    expectTypeOf(body).resolves.toEqualTypeOf<TaskResult | ProjectResult>();
    await expect(body).resolves.toEqual({ target: 'task' });
  });
});
