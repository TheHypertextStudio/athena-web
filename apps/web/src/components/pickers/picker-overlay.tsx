'use client';

/**
 * `components/pickers/picker-overlay` — the one moved popover for "edit labels on N objects".
 *
 * @remarks
 * `ActionDefinition.run` (see `@/lib/actions`) cannot open UI, and `ObjectMeta` cannot carry a
 * task's live label set without a stale DOM round-trip — so "set labels" cannot be modeled as a
 * plain registry action. Instead this is one popover, mounted once near the top of the app tree,
 * that any surface can summon through `usePickerOverlay().open(...)`: the `L` hotkey (via
 * `EntityTable`'s `onRowPropertyKey`, which already has the row's labels and passes them as
 * `current`) and the `task.label` context-menu action (which does not, and lets the popover
 * resolve them) both call the same `open`.
 *
 * One overlay moved to the target, not one picker mounted per row — the per-row composers
 * (`task-properties-rail.tsx` and friends) keep mounting their own `LabelsPicker` unchanged,
 * since they already have an anchor and don't need this indirection.
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PopoverVirtualAnchor } from '@docket/ui/primitives';

import type { ObjectRef } from '@/lib/actions';
import type { RelationId } from '@docket/work/relation-contract';

import { InitiativeHierarchyPickerOverlay } from '../initiatives/initiative-hierarchy-picker-overlay';
import { TaskHierarchyPickerOverlay } from '../tasks/task-hierarchy-picker-overlay';
import { LabelPickerOverlay } from './label-picker-overlay';
import { RelationTargetPickerOverlay } from './relation-target-picker-overlay';

/** A request to edit the label set of one or more objects. */
export interface LabelPickerRequest {
  readonly kind: 'labels';
  /** The workspace the objects belong to. */
  readonly organizationId: string;
  /** The objects being edited, in display order. Always at least one. */
  readonly objects: readonly ObjectRef[];
  /**
   * Each object's current label ids, keyed by `objectKey(object)`, when the caller already has
   * them (the `L` hotkey does — the row it fired on already renders its labels). Omit to have the
   * popover resolve them itself (the right-click path, which is already a two-step gesture).
   */
  readonly current?: ReadonlyMap<string, readonly string[]>;
  /** Anchor element for the popover. Defaults to `document.activeElement`. */
  readonly anchor?: HTMLElement | null;
}

/** A request to choose a parent for an Initiative or move another Initiative beneath it. */
export interface InitiativeHierarchyPickerRequest {
  readonly kind: 'initiative-hierarchy';
  readonly mode: 'parent' | 'child';
  readonly organizationId: string;
  readonly subject: ObjectRef & { readonly kind: 'initiative' };
  readonly anchor?: HTMLElement | null;
}

/** A request to make one or more existing tasks subtasks of a chosen task. */
export interface TaskHierarchyPickerRequest {
  readonly kind: 'task-hierarchy';
  readonly organizationId: string;
  readonly subjects: readonly (ObjectRef & { readonly kind: 'task' })[];
  readonly anchor?: HTMLElement | null;
}

/** A request to choose the target for one registered relation action. */
export interface RelationTargetPickerRequest {
  readonly kind: 'relation-target';
  readonly relationId: RelationId;
  readonly organizationId: string | null;
  readonly subjects: readonly ObjectRef[];
  readonly anchor?: HTMLElement | null;
}

/** Every picker the single app overlay can move to an invoking object. */
export type PickerOverlayRequest =
  | LabelPickerRequest
  | InitiativeHierarchyPickerRequest
  | TaskHierarchyPickerRequest
  | RelationTargetPickerRequest;

/** Stable fallback geometry and focus ownership captured when a moved picker opens. */
export interface CapturedPickerAnchor {
  readonly virtual: PopoverVirtualAnchor | null;
  readonly focusTarget: HTMLElement | null;
}

/**
 * Preserve an invoking element's geometry when a temporary menu unmounts it.
 *
 * @param anchor - The live control that opened the moved picker.
 * @returns Stable virtual geometry plus the original focus target.
 */
export function capturePickerAnchor(anchor: HTMLElement | null): CapturedPickerAnchor {
  if (anchor === null) return { virtual: null, focusTarget: null };
  const fallbackRect = anchor.getBoundingClientRect();
  return {
    virtual: {
      getBoundingClientRect: () =>
        anchor.isConnected ? anchor.getBoundingClientRect() : fallbackRect,
    },
    focusTarget: anchor,
  };
}

/** What `usePickerOverlay()` exposes. */
export interface PickerOverlayApi {
  /** Open the requested object picker. Replaces any request already open. */
  readonly open: (request: PickerOverlayRequest) => void;
}

const PickerOverlayContext = createContext<PickerOverlayApi | null>(null);

/** Thrown when `usePickerOverlay` is used outside a {@link PickerOverlayProvider}. */
class MissingPickerOverlayError extends Error {
  constructor() {
    super('No picker overlay is mounted. Wrap the app in <PickerOverlayProvider>.');
    this.name = 'MissingPickerOverlayError';
  }
}

/** The app's one picker-overlay controller. */
export function usePickerOverlay(): PickerOverlayApi {
  const value = useContext(PickerOverlayContext);
  if (value === null) throw new MissingPickerOverlayError();
  return value;
}

/** Props for {@link PickerOverlayProvider}. */
export interface PickerOverlayProviderProps {
  readonly children: ReactNode;
}

/**
 * Mount the app's one picker overlay.
 *
 * @remarks
 * Mount high in the tree — above both `ActionDomainsProvider` (whose `task.label` action calls
 * `usePickerOverlay()`) and every task list (whose `L` hotkey does too) — and exactly once, for
 * the same "exactly one" reason `InteractionProvider` is mounted exactly once.
 */
export function PickerOverlayProvider({ children }: PickerOverlayProviderProps): JSX.Element {
  const [request, setRequest] = useState<PickerOverlayRequest | null>(null);
  // Forces a clean remount of LabelPickerOverlay per open() call, so its internal "resolved
  // current, seeded once" state and its anchor ref (captured at mount) never leak across requests.
  const sequenceRef = useRef(0);

  const api = useMemo<PickerOverlayApi>(
    () => ({
      open: (next) => {
        sequenceRef.current += 1;
        setRequest(next);
      },
    }),
    [],
  );

  return (
    <PickerOverlayContext.Provider value={api}>
      {children}
      {request ? (
        request.kind === 'labels' ? (
          <LabelPickerOverlay
            key={sequenceRef.current}
            request={request}
            onClose={() => {
              setRequest(null);
            }}
          />
        ) : request.kind === 'initiative-hierarchy' ? (
          <InitiativeHierarchyPickerOverlay
            key={sequenceRef.current}
            request={request}
            onClose={() => {
              setRequest(null);
            }}
          />
        ) : request.kind === 'task-hierarchy' ? (
          <TaskHierarchyPickerOverlay
            key={sequenceRef.current}
            request={request}
            onClose={() => {
              setRequest(null);
            }}
          />
        ) : (
          <RelationTargetPickerOverlay
            key={sequenceRef.current}
            request={request}
            onClose={() => {
              setRequest(null);
            }}
          />
        )
      ) : null}
    </PickerOverlayContext.Provider>
  );
}
