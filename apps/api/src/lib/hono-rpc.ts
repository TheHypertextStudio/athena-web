import type { ToSchema } from 'hono/types';

/** Build one named route while retaining distinct wire and parsed validator input types. */
export type JsonRoute<
  TMethod extends string,
  TPath extends string,
  TWireInput,
  TParsedInput,
  TOutput,
> = ToSchema<TMethod, TPath, { in: TWireInput; out: TParsedInput }, TOutput>;
