/**
 * Validate an RPC body against a runtime schema without leaving the query layer's error contract.
 *
 * @remarks
 * The parse runs inside the query's own fetcher, so a rejection is caught by `unwrap` and converted
 * to a `ContractMismatchError` rather than escaping as a bare `ZodError`. That is what lets a deploy
 * skew be told apart from a dropped connection — both used to arrive as an indistinguishable
 * `status: 0`.
 */
import { rpcErrorResponse, type RpcResponse } from '@/lib/query';

/** The minimum a schema needs to expose to validate a decoded body. */
export interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

/**
 * Call an RPC endpoint and validate its body.
 *
 * @param call - The RPC invocation.
 * @param schema - The contract the body must satisfy.
 * @returns the response carrying the validated value, or the original failure response.
 * @throws when the body does not satisfy `schema`.
 */
export async function validatedRpcResponse<T>(
  call: () => Promise<RpcResponse<unknown>>,
  schema: RuntimeSchema<T>,
): Promise<RpcResponse<T>> {
  const response = await call();
  if (!response.ok) return rpcErrorResponse<T>(response);
  const value = schema.parse(await response.json());
  return { ok: true, status: response.status, json: async () => value };
}
