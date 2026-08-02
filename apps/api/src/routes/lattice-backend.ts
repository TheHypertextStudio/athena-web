/**
 * `@docket/api` — choosing which model backend one person's Athena turns run on.
 *
 * @remarks
 * ## The problem this solves
 *
 * `resolveModelBackend` in `@docket/agent-runtime` picks a backend from the *process* environment.
 * That is right for the tiers Docket operates — the Cloudflare model router on Docket's own key,
 * or direct provider access — because those are properties of the deployment. It cannot express
 * Lattice, because Lattice is a property of a *person*: their grant, their device. Two users on
 * the same API instance must be able to be on different backends in the same second.
 *
 * So this module is the per-owner layer above that seam. It does not replace it and does not
 * duplicate its logic: no connection, not enabled, or no device ⇒ it hands back the container's
 * process-level runtime, unchanged.
 *
 * ## The one thing it must never do
 *
 * Fall back. If someone has switched their Athena onto their own machine and that machine is
 * asleep, the turn fails with an actionable reason. It does not quietly run on a cloud model. The
 * whole reason a person chooses local inference is to know where their data went, and a silent
 * fallback would make that unknowable from inside Docket.
 */
import {
  LatticeAgentTurnRuntime,
  type AgentTurnRuntime,
  type LatticeChatPort,
} from '@docket/agent-runtime';
import {
  LatticeUnavailableError,
  runLatticeChat,
  type LatticeGatewayContext,
} from '@docket/integrations';

import { getContainer } from '../container';
import {
  latticeGatewayContext,
  loadLatticeConnection,
  recordLatticeFailure,
} from './lattice-connection';
import { latticeSequencingSatisfied } from './lattice-gate';

/** Which backend a resolution landed on, for logging and for the session's own record. */
export type ResolvedBackendKind = 'lattice' | 'default';

/** A resolved per-owner turn runtime plus what it turned out to be. */
export interface ResolvedOwnerBackend {
  /** The runtime the loop should drive this turn with. */
  readonly runtime: AgentTurnRuntime;
  /** Which backend it is. */
  readonly kind: ResolvedBackendKind;
  /** The device the turn will run on, when it is a Lattice backend. */
  readonly deviceId: string | null;
}

/**
 * Build the injected chat edge for one person and device.
 *
 * @remarks
 * This is the only place the gateway call is bound to a device id. Keeping it here rather than in
 * `@docket/agent-runtime` is what lets that package stay free of OAuth and HTTP.
 *
 * @param gateway - How to reach the gateway as that person.
 * @param deviceId - The device to run on.
 * @returns The port the turn runtime drives.
 */
export function latticeChatPort(
  gateway: LatticeGatewayContext,
  deviceId: string,
  ownerUserId: string,
): LatticeChatPort {
  return {
    async runChat(request) {
      let completion;
      try {
        completion = await runLatticeChat(gateway, {
          deviceId,
          messages: request.messages,
          maxTokens: request.maxTokens,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        });
      } catch (cause) {
        // Stamp the reason on the connection before rethrowing. A turn is usually where someone
        // first discovers their laptop went to sleep, and without this the settings surface would
        // still be showing the last successful read — cheerfully reporting "Ready" about a machine
        // that just refused a request.
        if (cause instanceof LatticeUnavailableError) {
          await recordLatticeFailure(ownerUserId, cause.reason);
        }
        throw cause;
      }
      const choice = completion.choices[0];
      return {
        text: choice?.message.content ?? '',
        ...(choice?.finish_reason === undefined ? {} : { finishReason: choice.finish_reason }),
        model: completion.model,
      };
    },
  };
}

/**
 * Resolve the turn runtime for one Athena owner.
 *
 * @remarks
 * A `null` owner (a registered agent rather than a personal Athena) always uses the process
 * backend: there is no person whose devices could be asked for.
 *
 * A stored grant that cannot produce a usable token throws rather than degrading. The alternative
 * — quietly running on the default backend — is exactly the silent fallback this feature exists to
 * rule out.
 *
 * @param ownerUserId - The session's owner, or null for a non-personal agent.
 * @returns The runtime to drive this turn with, and what it is.
 * @throws {LatticeUnavailableError} When the owner is on Lattice but it cannot serve right now.
 */
export async function resolveOwnerBackend(
  ownerUserId: string | null,
): Promise<ResolvedOwnerBackend> {
  const fallback: ResolvedOwnerBackend = {
    runtime: getContainer().agentTurn,
    kind: 'default',
    deviceId: null,
  };
  if (!ownerUserId || !latticeSequencingSatisfied()) return fallback;

  const connection = await loadLatticeConnection(ownerUserId);
  // Not connected, switched off, or no device chosen are all ordinary "this person is on the
  // default backend" states, not failures.
  if (!connection || !connection.enabled || connection.status !== 'connected') return fallback;
  if (!connection.deviceId) return fallback;

  const gateway = await latticeGatewayContext(connection);
  const deviceId = connection.deviceId;
  return {
    runtime: new LatticeAgentTurnRuntime({
      chat: latticeChatPort(gateway, deviceId, ownerUserId),
    }),
    kind: 'lattice',
    deviceId,
  };
}

/**
 * Resolve just the turn runtime for one owner.
 *
 * @remarks
 * The narrow signature the agent loop calls, so the loop's own module needs no knowledge of
 * Lattice beyond "ask who this session belongs to".
 *
 * @param ownerUserId - The session's owner, or null for a non-personal agent.
 * @returns The runtime to drive this turn with.
 * @throws {LatticeUnavailableError} When the owner is on Lattice but it cannot serve right now.
 */
export async function resolveOwnerTurnRuntime(
  ownerUserId: string | null,
): Promise<AgentTurnRuntime> {
  return (await resolveOwnerBackend(ownerUserId)).runtime;
}

export { LatticeUnavailableError };
