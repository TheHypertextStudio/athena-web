/**
 * `routes/time-submissions` — recipient-scoped workspace Time Ledger reports.
 *
 * @remarks
 * This router deliberately lives below an organization context. It exposes only immutable
 * submitted allocation credits, never a contributor's Hub, Time Record ids, titles, contexts,
 * or live intervals.
 */
import { TimeSubmissionRecipientListOut } from '@docket/types';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { capabilityGuard } from '../permissions/capability-guard';
import { listOrganizationTimeSubmissions } from '../time/service';

/** Recipient-scoped immutable reports for one workspace. */
const timeSubmissions = new Hono<AppEnv>().get(
  '/',
  capabilityGuard('view'),
  apiDoc({
    tag: 'Time',
    summary: 'List submitted workspace time reports',
    capability: 'view',
    response: TimeSubmissionRecipientListOut,
    description:
      'List immutable Time Ledger report snapshots submitted to this workspace. The response contains only recipient-scoped allocation credit and declared reporting policy; private Hub records, titles, contexts, and live timing remain unavailable to workspace readers.',
  }),
  async (c) => {
    const { orgId } = c.get('actorCtx');
    return ok(c, TimeSubmissionRecipientListOut, {
      items: await listOrganizationTimeSubmissions(orgId),
    });
  },
);

export default timeSubmissions;
