/** Frozen0154 source rows; this island must not import evolving domain/runtime schemas. */
export type RetainedRow = Readonly<Record<string, string | number | null>>;
/** Frozen retained graph returned by the0154 SQL source projection. */
export interface RetainedGraph {
  readonly definition: RetainedRow;
  readonly revision: RetainedRow;
  readonly steps: readonly RetainedRow[];
  readonly projects: readonly RetainedRow[];
  readonly milestones: readonly RetainedRow[];
  readonly tasks: readonly RetainedRow[];
  readonly taskLabels: readonly RetainedRow[];
  readonly projectLabels: readonly RetainedRow[];
  readonly dependencies: readonly RetainedRow[];
}
/** Frozen reusable step projection shape, independent of later domain defaults. */
export interface ConvertedStep {
  readonly key: string;
  readonly kind: 'project' | 'milestone' | 'task';
  readonly parentStepKey: string | null;
  readonly sort: number;
  readonly optional: { readonly enabled: false; readonly selectedByDefault: true };
  readonly template: null | {
    readonly workTypeId: string;
    readonly selection: { readonly kind: 'pinned'; readonly workTypeVersionId: string };
  };
  readonly teamRule: 'creation_team';
  readonly actorRule: 'unassigned';
  readonly cycleRule?: 'none';
  readonly fields: Readonly<Record<string, string | number | readonly string[]>>;
  readonly dates: Readonly<Record<string, FrozenDateRule>>;
}
/** Frozen timing format; literal trigger/cross-root timing remains restricted context. */
export type FrozenDateRule =
  | {
      readonly kind: 'anchor';
      readonly anchor: { readonly kind: 'parent' };
      readonly offset: { readonly days: number; readonly unit: 'calendar' };
    }
  | {
      readonly kind: 'after_completion';
      readonly stepKeys: readonly string[];
      readonly offset: { readonly days: number; readonly unit: 'calendar' };
    };
/** Immutable converted Project definition. */
export interface ConvertedDefinition {
  readonly name: string;
  readonly description: null;
  readonly icon: null;
  readonly defaultStatusKey: null;
  readonly payload:
    | { readonly targetType: 'project'; readonly name: string }
    | { readonly targetType: 'task'; readonly title: string };
  readonly blueprint: {
    readonly steps: readonly ConvertedStep[];
    readonly dependencies: readonly {
      readonly blockerStepKey: string;
      readonly blockedStepKey: string;
    }[];
  };
}
/** Required retained identifier/text with a safe error independent of private source values. */
export function required(row: RetainedRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`Malformed retained blueprint field: ${key}`);
  return value;
}
