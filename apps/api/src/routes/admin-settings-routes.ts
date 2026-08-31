/**
 * `@docket/api` — service-control routes for the operator back-office (mounted at
 * `/service-controls`).
 *
 * @remarks
 * The controls are ordinary product settings stored in `service_control` and read live by the
 * runtime they govern, so an operator turns a capability off (and back on) from the admin console
 * without a redeploy. Reading the current state is open to any staff tier; changing it requires
 * `superadmin` and writes an operator audit event per control changed.
 */
import { db, type ServiceControlKey } from '@docket/db';
import { Hono } from 'hono';

import { AdminServiceControlsOut, UpdateServiceControlsBody } from '../admin-dto';
import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';
import { readLatticeServiceControls, setServiceControl } from '../services/service-controls';

import { audit } from './admin-serializers';

/**
 * Read both controls in the DTO's shape.
 *
 * @returns Each control's current value, keyed by its request/response field name.
 */
async function currentControls(): Promise<AdminServiceControlsOut> {
  const { pollingEnabled, submissionsEnabled } = await readLatticeServiceControls();
  return { latticeSubmissionsEnabled: submissionsEnabled, latticePollingEnabled: pollingEnabled };
}

/** The request field carrying each control's new value, paired with the key it stores. */
const CONTROL_FIELDS = [
  { field: 'latticeSubmissionsEnabled', key: 'lattice_submissions' },
  { field: 'latticePollingEnabled', key: 'lattice_polling' },
] as const satisfies readonly { field: keyof UpdateServiceControlsBody; key: ServiceControlKey }[];

/**
 * Sub-router for instance-wide service controls.
 *
 * @remarks
 * Mounted under `/admin`, so every route here already runs behind `staffMiddleware`.
 */
export const adminSettingsRoutes = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Admin',
      summary: 'Get service controls',
      response: AdminServiceControlsOut,
      description: `Returns the instance-wide switches governing Athena's durable Lattice work.

**Behavior.** Reports \`latticeSubmissionsEnabled\` (whether the scheduled sweep submits new durable work to a person's Lattice runtime) and \`latticePollingEnabled\` (whether it polls and settles work already submitted). Each control reads \`true\` until an operator stores a value, so a deployment runs both capabilities by default. The scheduled sweep reads the same stored values on every run, so a change made through \`PATCH /admin/service-controls\` takes effect on the next sweep with no redeploy.

**Scope.** Instance-wide, covering every organization. Whether an individual person has connected a Lattice runtime is a separate, per-owner setting.

**Access.** Behind \`staffMiddleware\` (any staff tier — a read). Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None — a read; no audit event.

**Related.** \`PATCH /admin/service-controls\` changes them; \`GET /admin/audit\` records who changed what.`,
    }),
    async (c) => ok(c, AdminServiceControlsOut, await currentControls()),
  )
  .patch(
    '/',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Update service controls',
      response: AdminServiceControlsOut,
      description: `Changes one or both instance-wide Lattice controls and returns the state that now applies.

**Behavior.** Send only the controls you are changing: \`latticeSubmissionsEnabled\`, \`latticePollingEnabled\`, or both. An omitted control keeps its current value, and a body carrying neither is rejected with \`422 unprocessable_entity\`. Each supplied value is stored against its control key, and the response reports both controls as they now read. The scheduled sweep picks the new values up on its next run — no redeploy, no cache to wait out.

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\` on top of \`staffMiddleware\`: these switches suspend a capability for every organization at once. \`support\`/\`finance\` callers get \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** Writes one \`service_control.updated\` operator audit event per control changed (subject = the control key), capturing the value that was stored.

**Related.** \`GET /admin/service-controls\` for the current state; \`GET /admin/audit\` (superadmin) for the change history.`,
    }),
    zJson(UpdateServiceControlsBody),
    async (c) => {
      const body = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      for (const { field, key } of CONTROL_FIELDS) {
        const enabled = body[field];
        if (enabled === undefined) continue;
        const stored = await setServiceControl(key, enabled, staffUserId);
        await audit(db, staffUserId, 'service_control.updated', 'service_control', key, {
          key,
          enabled: stored,
        });
      }
      return ok(c, AdminServiceControlsOut, await currentControls());
    },
  );
