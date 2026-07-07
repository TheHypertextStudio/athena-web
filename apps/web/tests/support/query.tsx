import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

import type { RpcResponse } from '../../src/lib/query';

/** Build a successful {@link RpcResponse}-shaped mock for query/mutation tests. */
export function okResponse<T>(body: T): RpcResponse<T> {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

/** Build a platform problem response carrying a problem `detail`. */
export function problemResponse(detail: string, status = 422): Response {
  return Response.json({ detail }, { status });
}

/** Build a fresh retry-free TanStack Query wrapper for one hook test. */
export function makeQueryWrapper(): {
  readonly client: QueryClient;
  readonly wrapper: (props: { readonly children: ReactNode }) => JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { readonly children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
