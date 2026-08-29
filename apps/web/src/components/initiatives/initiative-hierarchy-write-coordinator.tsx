'use client';

import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useRef,
  useSyncExternalStore,
} from 'react';

import type { InitiativeHierarchyMutation } from './initiative-hierarchy-mutations';

/** A non-noop hierarchy mutation held by the shared write coordinator. */
export type CoordinatedInitiativeHierarchyMutation = Exclude<
  InitiativeHierarchyMutation,
  { readonly kind: 'noop' }
>;

/** Network and repair states that keep one Initiative child locked. */
export type InitiativeHierarchyWritePhase = 'writing' | 'refreshing' | 'refresh_failed';

/** Input required to claim one route-and-child hierarchy write lock. */
export interface InitiativeHierarchyWriteClaim {
  readonly organizationId: string;
  readonly childInitiativeId: string;
  readonly ownerId: string;
  readonly mutation: CoordinatedInitiativeHierarchyMutation;
}

/** Opaque ownership token returned for one successful hierarchy write claim. */
export interface InitiativeHierarchyWriteToken {
  readonly key: string;
  readonly nonce: symbol;
}

/** Observable operation retained while a write or required refresh blocks the child. */
export interface InitiativeHierarchyWriteOperation extends InitiativeHierarchyWriteClaim {
  readonly phase: InitiativeHierarchyWritePhase;
  readonly token: InitiativeHierarchyWriteToken;
}

/**
 * Serialize Initiative hierarchy writes by route workspace and child Initiative.
 *
 * @remarks
 * The picker provider owns one instance. Overlay replacement therefore cannot discard an active
 * child lock. Token checks also prevent a late operation from releasing a newer claim for the
 * same key.
 */
export class InitiativeHierarchyWriteCoordinator {
  private readonly operations = new Map<string, InitiativeHierarchyWriteOperation>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  /** Claim one child for a hierarchy write, or return null when that child is already busy. */
  claim(input: InitiativeHierarchyWriteClaim): InitiativeHierarchyWriteToken | null {
    const key = this.key(input.organizationId, input.childInitiativeId);
    if (this.operations.has(key)) return null;
    const token = { key, nonce: Symbol(key) };
    this.operations.set(key, { ...input, phase: 'writing', token });
    this.emit();
    return token;
  }

  /** Move an owned child lock into its next network or repair phase. */
  transition(token: InitiativeHierarchyWriteToken, phase: InitiativeHierarchyWritePhase): void {
    const operation = this.operations.get(token.key);
    if (operation?.token !== token) return;
    this.operations.set(token.key, { ...operation, phase });
    this.emit();
  }

  /** Release an owned child lock without disturbing a later claim for the same key. */
  release(token: InitiativeHierarchyWriteToken): void {
    const operation = this.operations.get(token.key);
    if (operation?.token !== token) return;
    this.operations.delete(token.key);
    this.emit();
  }

  /** Return whether one route-and-child key has a write or repair in progress. */
  isBusy(organizationId: string, childInitiativeId: string): boolean {
    return this.operations.has(this.key(organizationId, childInitiativeId));
  }

  /** Return the active operation owned by one picker instance. */
  operationForOwner(ownerId: string): InitiativeHierarchyWriteOperation | null {
    for (const operation of this.operations.values()) {
      if (operation.ownerId === ownerId) return operation;
    }
    return null;
  }

  /** Return the active operation for one route-and-child key. */
  operationForChild(
    organizationId: string,
    childInitiativeId: string,
  ): InitiativeHierarchyWriteOperation | null {
    return this.operations.get(this.key(organizationId, childInitiativeId)) ?? null;
  }

  /** Subscribe to claim, transition, and release changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Return the monotonic snapshot consumed by React subscriptions. */
  snapshot(): number {
    return this.revision;
  }

  private key(organizationId: string, childInitiativeId: string): string {
    return `${organizationId}\u0000${childInitiativeId}`;
  }

  private emit(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

const InitiativeHierarchyWriteCoordinatorContext =
  createContext<InitiativeHierarchyWriteCoordinator | null>(null);

/** Props for {@link InitiativeHierarchyWriteCoordinatorProvider}. */
export interface InitiativeHierarchyWriteCoordinatorProviderProps {
  readonly children: ReactNode;
  /** Optional injected coordinator for focused tests. */
  readonly coordinator?: InitiativeHierarchyWriteCoordinator;
}

/** Mount one hierarchy write coordinator above every picker overlay instance. */
export function InitiativeHierarchyWriteCoordinatorProvider({
  children,
  coordinator,
}: InitiativeHierarchyWriteCoordinatorProviderProps): JSX.Element {
  const ownedCoordinator = useRef<InitiativeHierarchyWriteCoordinator | null>(null);
  ownedCoordinator.current ??= new InitiativeHierarchyWriteCoordinator();
  return (
    <InitiativeHierarchyWriteCoordinatorContext.Provider
      value={coordinator ?? ownedCoordinator.current}
    >
      {children}
    </InitiativeHierarchyWriteCoordinatorContext.Provider>
  );
}

/** Return the hierarchy write coordinator mounted by the picker provider. */
export function useInitiativeHierarchyWriteCoordinator(): InitiativeHierarchyWriteCoordinator {
  const coordinator = useContext(InitiativeHierarchyWriteCoordinatorContext);
  if (coordinator === null) {
    throw new Error('Initiative hierarchy picker requires a write coordinator.');
  }
  return coordinator;
}

/** Subscribe a picker to shared hierarchy write phase changes. */
export function useInitiativeHierarchyWriteRevision(
  coordinator: InitiativeHierarchyWriteCoordinator,
): number {
  return useSyncExternalStore(
    (listener) => coordinator.subscribe(listener),
    () => coordinator.snapshot(),
    () => coordinator.snapshot(),
  );
}
