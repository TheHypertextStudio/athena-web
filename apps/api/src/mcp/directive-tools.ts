/**
 * `@docket/api` — `acknowledge_directive`: a consuming client closes the loop on a directive.
 *
 * @remarks
 * The write half of the `docket://hub/directive` resource (curfew-integration.md §3.3). A client
 * that read a directive reports back which posture it actually acted on, whether it changed
 * device state, and optionally why — so Athena (and the person, in Settings) can see whether a
 * device-control client is acting on what it is told rather than assuming it is.
 *
 * Per that spec's §0, nothing here names, models, or assumes any particular consumer. The tool
 * accepts a posture and a boolean, never an enforcement vocabulary, and the audit row records the
 * caller's registered OAuth client id ({@link McpContext.clientId}) as its only attribution.
 */
import { db } from '@docket/db';
import { DirectivePosture } from '@docket/types';
import { z } from 'zod';

import { recordAcknowledgment } from '../services/scheduling/directive-service';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { callerHub } from './plan-tools';
import { jsonResult, runTool } from './result';
import { requireScope } from './scope';

/** Register `acknowledge_directive` on `server`. */
export function registerDirectiveTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'acknowledge_directive',
    {
      title: 'Acknowledge a directive',
      description:
        'Report what the calling client did with a directive read from `docket://hub/directive`: which posture it acted on, whether it changed device state in response, and an optional note. Echo the `directiveId` from the payload that was acted on. Retries are safe — a directive holds one acknowledgment, and a repeat call overwrites it rather than appending a duplicate.',
      inputSchema: {
        directiveId: z
          .string()
          .min(1)
          .describe('The `directiveId` being acknowledged, echoed from `docket://hub/directive`.'),
        appliedPosture: DirectivePosture.describe('The posture the client actually acted on.'),
        enforced: z
          .boolean()
          .describe('Whether the client changed device state in response to the directive.'),
        note: z.string().max(500).optional().describe('Optional context, in the client’s words.'),
      },
      outputSchema: {
        acknowledged: z.literal(true),
        acknowledgedAt: z.string().describe('When the acknowledgment was recorded.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        // Upsert on (hub, directiveId): the same call twice leaves the same single row.
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // Hub-only resolution, like `brief`/`plan_day`: no orgId and no per-org grant cascade,
        // because a directive is personal and cross-org. That leaves the token scope as the one
        // authorization layer, so it is asserted here rather than trusted to the transport
        // preflight — an in-process caller must hit the same gate an HTTP one does.
        requireScope(ctx.scopes, 'work:write');
        const { hubId, userId } = await callerHub(ctx);
        const receipt = await recordAcknowledgment(db, {
          hubId,
          clientId: ctx.clientId ?? null,
          body: {
            directiveId: input.directiveId,
            appliedPosture: input.appliedPosture,
            enforced: input.enforced,
            note: input.note ?? null,
          },
          userId,
          now: new Date(),
        });
        return jsonResult(receipt);
      }),
  );
}
