import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

interface EventContract {
  event: string;
  payload: z.ZodType;
  wireExample: string;
}

function parseWireExample(contract: EventContract): unknown {
  const lines = contract.wireExample.trimEnd().split('\n');
  expect(lines).toContain(`event: ${contract.event}`);
  const data = lines.find((line) => line.startsWith('data: '));
  expect(data).toBeDefined();
  return contract.payload.parse(JSON.parse((data ?? '').slice('data: '.length)));
}

describe('SSE route contracts', () => {
  it('publishes schema-valid literal frames for every route-owned event family', async () => {
    const module = (await import('../../src/routes/stream-contracts').catch(() => ({}))) as {
      rootStreamEventContracts?: readonly EventContract[];
      sessionActivityEventContracts?: readonly EventContract[];
      organizationHeartbeatEventContract?: EventContract;
      agentUpdateEventContracts?: readonly EventContract[];
    };

    expect(module.rootStreamEventContracts).toHaveLength(2);
    expect(module.sessionActivityEventContracts).toHaveLength(5);
    expect(module.organizationHeartbeatEventContract).toBeDefined();
    expect(module.agentUpdateEventContracts).toHaveLength(5);

    const contracts = [
      ...(module.rootStreamEventContracts ?? []),
      ...(module.sessionActivityEventContracts ?? []),
      module.organizationHeartbeatEventContract,
      ...(module.agentUpdateEventContracts ?? []),
    ].filter((contract): contract is EventContract => contract !== undefined);

    for (const contract of contracts) expect(parseWireExample(contract)).toBeDefined();
  });
});
