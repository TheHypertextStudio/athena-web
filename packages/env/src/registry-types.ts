import type { z } from 'zod';

/** The logical group a var belongs to (mirrors the slice files). */
export type Slice =
  | 'shared'
  | 'db'
  | 'auth'
  | 'stripe'
  | 'mcp'
  | 'agent'
  | 'ops'
  | 'connector'
  | 'client';
/** Whether a var is server-only or a public client var. */
export type Scope = 'server' | 'client';
/** Which deployable surface(s) consume a var. */
export type Target = 'api' | 'web' | 'marketing' | 'admin';

/** Metadata for one environment variable — drives validation hints + bootstrap prompts. */
export interface VarSpec {
  readonly name: string;
  readonly slice: Slice;
  readonly scope: Scope;
  readonly targets: readonly Target[];
  readonly required: boolean;
  readonly zod: z.ZodType;
  /** Human hint: where to obtain/generate this value. Printed by `pnpm env:check`. */
  readonly where: string;
  readonly sensitive?: boolean;
  /** Optional shell snippet to generate the value (used by the bootstrap prompt). */
  readonly generate?: string;
}

/** Shorthand for all app targets (web + marketing + admin). */
export const APP: readonly Target[] = ['web', 'marketing', 'admin'];
/** Shorthand for every deployment target. */
export const ALL: readonly Target[] = ['api', 'web', 'marketing', 'admin'];
