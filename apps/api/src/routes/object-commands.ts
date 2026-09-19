/** Organization-scoped transactional object commands and conflict-safe receipt replay. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import {
  ObjectCommandReplayAccessIn,
  ObjectCommandReplayAccessResult,
  ObjectCommandRequest,
  ObjectCommandResult,
} from '../contracts/object-command';
import type { AppEnv } from '../context';
import { PayloadTooLargeError } from '../error';
import { MAX_OBJECT_COMMAND_BYTES } from '../lib/http-limits';
import { executeForward } from '../lib/object-command/execute-forward';
import { executeReplay } from '../lib/object-command/execute-replay';
import { scheduleCommandEffects } from '../lib/object-command/effects';
import { ownedValidation } from '../lib/object-command/receipt-validator';
import { checkReplayAccess } from '../lib/object-command/replay-access';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import * as taskState from '../lib/task-state';
import { zJson } from '../lib/validate';

const commandBodyLimit = bodyLimit({
  maxSize: MAX_OBJECT_COMMAND_BYTES,
  onError: () => {
    throw new PayloadTooLargeError(MAX_OBJECT_COMMAND_BYTES);
  },
});

/** POST endpoints for replay access checks and transactional object commands. */
const objectCommands = new Hono<AppEnv>()
  .post(
    '/replay-access',
    commandBodyLimit,
    apiDoc({
      tag: 'Objects',
      summary: 'Check current access to replay an object command',
      response: ObjectCommandReplayAccessResult,
    }),
    zJson(ObjectCommandReplayAccessIn),
    async (c) => {
      const { direction, receipt } = c.req.valid('json');
      const { orgId, actorId } = c.get('actorCtx');
      return ok(
        c,
        ObjectCommandReplayAccessResult,
        await checkReplayAccess(orgId, actorId, direction, receipt),
      );
    },
  )
  .post(
    '/',
    commandBodyLimit,
    apiDoc({
      tag: 'Objects',
      summary: 'Apply, undo, or redo an object command',
      response: ObjectCommandResult,
    }),
    zJson(ObjectCommandRequest),
    async (c) => {
      const request = c.req.valid('json');
      const key = c.req.header('Idempotency-Key');
      if (key !== request.commandId) {
        throw ownedValidation('Idempotency-Key must match commandId', ['commandId']);
      }
      const { orgId, actorId } = c.get('actorCtx');
      const idempotencyClaim = c.get('idempotencyClaim');
      const execution =
        'direction' in request
          ? await executeReplay(orgId, actorId, request, idempotencyClaim)
          : await executeForward(orgId, actorId, request, idempotencyClaim);
      if (idempotencyClaim) c.set('idempotencyCompleted', true);
      await taskState.emitCompletedTaskTimerStops(execution.effects.timerStops);
      scheduleCommandEffects();
      return ok(c, ObjectCommandResult, execution.result);
    },
  );

export default objectCommands;
