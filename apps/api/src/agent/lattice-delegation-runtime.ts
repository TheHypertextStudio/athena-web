/** Production Lovelace package adapter for durable Athena delegation. */
import {
  RelayControllerClient,
  buildAgentTaskCommand,
  toSurfaceWorkState,
} from '@lovelace-ai/lattice-relay-client';
import { generateWorkKey, openWork, sealWork } from '@lovelace-ai/lattice-relay-crypto';
import { LATTICE_GATEWAY_BASE_URL } from '@docket/integrations';

import { latticeGatewayContext, type LatticeConnectionRow } from '../routes/lattice-connection';
import type { LatticeDelegationDependencies } from './lattice-delegations';

async function clientFor(connection: LatticeConnectionRow): Promise<RelayControllerClient> {
  const gateway = await latticeGatewayContext(connection);
  const gatewayBase = (gateway.baseUrl ?? LATTICE_GATEWAY_BASE_URL).replace(/\/$/u, '');
  return new RelayControllerClient({
    baseUrl: `${gatewayBase}/v1/personal-relay`,
    getToken: () => gateway.accessToken,
    seal: sealWork,
  });
}

/** Official Lovelace implementations used by the production scheduler and routes. */
export const latticeDelegationDependencies: LatticeDelegationDependencies = {
  async generateReplyKey(keyId) {
    return await generateWorkKey(keyId);
  },
  buildAgentTaskCommand,
  async listRuntimes(connection) {
    return await (await clientFor(connection)).listRuntimes();
  },
  async submitWork(connection, input) {
    return await (await clientFor(connection)).submitWork(input);
  },
  async pollEvents(connection, workId, cursor) {
    const response = await (await clientFor(connection)).pollEvents(workId, cursor);
    return { ...response, state: toSurfaceWorkState(response.state) };
  },
  async openWork(envelope, privateKey, aad) {
    const plaintext = await openWork(envelope, privateKey, aad);
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  },
  async cancelWork(connection, workId) {
    const accepted = await (await clientFor(connection)).cancelWork(workId);
    return { state: toSurfaceWorkState(accepted.state) };
  },
  async acknowledgeResult(connection, workId) {
    const accepted = await (await clientFor(connection)).acknowledgeResult(workId);
    return {
      state: toSurfaceWorkState(accepted.state),
      acknowledgedAt: accepted.acknowledgedAt,
    };
  },
};
