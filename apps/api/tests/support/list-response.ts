/** Read a list envelope so route tests can assert its items without discarding the wire contract. */
export async function listItems<T = unknown>(response: Response | Promise<Response>): Promise<T[]> {
  const body = (await (await response).json()) as { items: T[] };
  if (!Array.isArray(body.items)) throw new Error('Expected a list response with an items array');
  return body.items;
}
