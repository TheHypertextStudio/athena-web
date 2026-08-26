import type { LucideIcon } from '@docket/ui/icons';

/** The vocabulary-sensitive labels that the application shell exposes. */
export interface CapabilityVocabulary {
  readonly task: string;
  readonly initiative: string;
  readonly program: string;
  readonly project: string;
  readonly cycle: string;
  readonly team: string;
}

/** Application state that can change which shipped capabilities a person may reach. */
export interface CapabilityContext {
  readonly activeOrgId: string | null;
  readonly activeOrgName: string | null;
  readonly activeOrgIsPersonal: boolean;
  readonly canManageActiveOrg: boolean;
  readonly panelsAvailable: boolean;
  readonly vocabulary: CapabilityVocabulary;
}

/** A shell-owned effect that a catalog entry can request without capturing a React callback. */
export type CapabilityIntent =
  | { readonly type: 'open-panel'; readonly panelId: 'agenda' | 'focus' | 'athena' }
  | {
      readonly type: 'create';
      readonly kind: 'task' | 'project' | 'initiative' | 'program';
      readonly templateId?: string;
    }
  | { readonly type: 'create-workspace' }
  | { readonly type: 'cycle-density' }
  | { readonly type: 'sign-out' };

/** A concrete destination that the command host knows how to execute. */
export type CapabilityTarget =
  | { readonly type: 'route'; readonly href: string }
  | { readonly type: 'intent'; readonly intent: CapabilityIntent };

type ContextValue<T> = T | ((context: CapabilityContext) => T);

/** The unresolved target stored by a feature-owned catalog. */
export type CapabilityTargetDefinition =
  | { readonly type: 'route'; readonly href: ContextValue<string> }
  | { readonly type: 'intent'; readonly intent: CapabilityIntent };

/** Static application metadata shared by its view and the command palette. */
export interface AppCapability {
  readonly id: string;
  readonly label: ContextValue<string>;
  readonly description: string;
  readonly aliases?: readonly string[];
  readonly icon: LucideIcon;
  readonly breadcrumb?: ContextValue<readonly string[]>;
  readonly scope: 'global' | 'workspace';
  readonly requiresQuery?: boolean;
  readonly target: CapabilityTargetDefinition;
  readonly available?: (context: CapabilityContext) => boolean;
}

/** A capability after its context-sensitive label, route, and ownership have been resolved. */
export interface ResolvedCapability {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly icon: LucideIcon;
  readonly breadcrumb: readonly string[];
  readonly requiresQuery: boolean;
  readonly target: CapabilityTarget;
  readonly org?: { readonly id: string; readonly name: string };
}
