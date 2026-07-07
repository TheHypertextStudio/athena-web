type MockCalls = readonly (readonly unknown[])[];

class JsonResponseDouble<T> extends Response {
  readonly #body: T;

  constructor(ok: boolean, body: T) {
    super(null, { status: ok ? 200 : 400 });
    this.#body = body;
  }

  override json(): Promise<T> {
    return Promise.resolve(this.#body);
  }
}

/** Build a real JSON {@link Response} with the requested success state. */
export function jsonResponse(ok: boolean, body: unknown): Response {
  return new JsonResponseDouble(ok, body);
}

/** Read the `json` payload from the first call to an RPC-style mock. */
export function firstJson(calls: MockCalls): Record<string, unknown> {
  const call = calls[0];
  if (!call) throw new Error('expected the RPC spy to have been called');

  const arg = call[0];
  if (typeof arg !== 'object' || arg === null || !('json' in arg)) {
    throw new Error('expected the RPC spy to receive a json payload');
  }

  const { json } = arg;
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('expected the RPC json payload to be an object');
  }

  return json as Record<string, unknown>;
}
