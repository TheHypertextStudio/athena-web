/**
 * `@docket/types` — compatibility facade for capability vocabulary + shared work enums.
 *
 * @remarks
 * Capability vocabulary belongs to Identity & Access. This facade keeps the existing
 * Types contract stable while `Visibility` and `Health` remain transport contracts here.
 */
import { z } from 'zod';

/** Compatibility re-exports for Identity & Access-owned capability vocabulary. */
export {
  Capability,
  CAPABILITY_RANK,
  GrantCapability,
  satisfies,
} from '@docket/identity-access/capabilities';

/** Resource visibility: public to org members, or private (grant-only). */
export const Visibility = z
  .enum(['public', 'private'])
  .describe(
    'Resource reach. `public`: visible to every member of the org (subject to capability). `private`: visible only to actors holding an explicit grant on the resource.',
  );
/** Resource visibility value. */
export type Visibility = z.infer<typeof Visibility>;

/** Judgment-based health for Projects/Programs/Initiatives. */
export const Health = z
  .enum(['on_track', 'at_risk', 'off_track'])
  .describe(
    'A human judgment of how a Project/Program/Initiative is trending, independent of mechanical status. `on_track`: expected to land as planned. `at_risk`: threatened, needs attention. `off_track`: not expected to land without intervention.',
  );
/** Health value. */
export type Health = z.infer<typeof Health>;

/**
 * Compatibility re-export for the Work-owned task-priority contract.
 *
 * @remarks
 * New Work code imports `@docket/work/task-contract` directly. This legacy
 * path remains so existing consumers can migrate without changing behavior.
 */
export { Priority } from '@docket/work/task-contract';
