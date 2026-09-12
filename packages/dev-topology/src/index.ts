/**
 * `@docket/dev-topology` — the one definition of which hosts and ports a local checkout serves.
 *
 * @remarks
 * Import this rather than writing a hostname, a port, or a list of host-bearing variables
 * anywhere else. The knowledge used to be duplicated across the checked-in env file,
 * `scripts/portless-env.ts`, `apps/api/src/dev-env.ts`, `scripts/dev-stack.sh`, and
 * `.claude/launch.json`; two of those copies had already drifted, and the drift surfaced as broken
 * authentication rather than as a configuration error.
 *
 * Two dev modes share this topology:
 *
 * - **Portless** (`pnpm dev`): Portless assigns each app a hostname and a free port, and
 *   {@link applyDevHostPrefix} corrects the environment to match what it assigned.
 * - **Explicit ports** (`scripts/dev-stack.sh`): {@link explicitPortTopology} derives a port block
 *   from the checkout and addresses every process directly, with no proxy in the path.
 */
export type { CheckoutIdentity } from './checkout';
export {
  checkoutSlot,
  derivePortlessRunnerPort,
  deriveWebPort,
  hostPrefix,
  isLinkedWorktree,
  PORT_STRIDE,
  PORTLESS_RUNNER_FLOOR,
  PRIMARY_WEB_PORT,
  readCheckoutIdentity,
  WORKTREE_PORT_FLOOR,
  WORKTREE_SLOTS,
} from './checkout';
export type { TopologyFinding } from './consistency';
export { assertDevTopology, checkDevTopology, formatTopologyFindings } from './consistency';
export type { EnvBag } from './hosts';
export {
  applyDevHostPrefix,
  canonicalServiceHost,
  DELIBERATELY_UNPREFIXED,
  DEV_DOMAIN,
  HOST_BEARING_VARS,
  portlessPrefix,
  prefixDevHosts,
} from './hosts';
export type { DevTopology, PortBlock } from './topology';
export { explicitPortTopology, portBlock, PORTS_PER_CHECKOUT, shellExports } from './topology';
