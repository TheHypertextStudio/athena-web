import type { InferRequestType, InferResponseType } from 'hono/client';

import type { api } from '../api';

type ObjectCommandEndpoint = (typeof api.v1.orgs)[':orgId']['object-commands']['$post'];
type ReplayAccessEndpoint =
  (typeof api.v1.orgs)[':orgId']['object-commands']['replay-access']['$post'];

/** The request body accepted by the object-command endpoint. */
export type ObjectCommandRequest = InferRequestType<ObjectCommandEndpoint>['json'];

/** A validated forward command over one homogeneous set of tasks or projects. */
export type ObjectCommandIn = Exclude<ObjectCommandRequest, { direction: unknown }>;

/** A request to undo or redo a normalized receipt. */
export type ObjectCommandReplayIn = Extract<ObjectCommandRequest, { direction: unknown }>;

/** The result of a forward command or conflict-safe replay. */
export type ObjectCommandResult = InferResponseType<ObjectCommandEndpoint, 200>;

/** A replay-safe normalized command receipt. */
export type ObjectCommandReceipt = ObjectCommandResult['receipt'];

/** A normalized object-field change stored in a replay receipt. */
export type ObjectCommandObjectReceiptEntry = Extract<
  ObjectCommandReceipt['entries'][number],
  { kind: 'object' }
>;

/** A normalized association or dependency edge stored in a replay receipt. */
export type ObjectCommandRelationReceiptEntry = Extract<
  ObjectCommandReceipt['entries'][number],
  { kind: 'relation' }
>;

/** A JSON-safe scalar stored before or after an object-field change. */
export type ObjectCommandValue = ObjectCommandObjectReceiptEntry['before'];

/** A read-only request to check whether the current actor may replay one receipt. */
export type ObjectCommandReplayAccessIn = InferRequestType<ReplayAccessEndpoint>['json'];

/** Current replay access for every object and dependency endpoint in one receipt. */
export type ObjectCommandReplayAccessResult = InferResponseType<ReplayAccessEndpoint, 200>;
