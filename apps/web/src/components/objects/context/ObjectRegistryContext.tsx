'use client';

/**
 * ObjectRegistry Context
 *
 * Central registry for all visible Athena objects. Provides global awareness
 * of objects for features like command palette search and cross-surface
 * interactions.
 */

import { createContext, useContext, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { AnyObject, ObjectType, SurfaceId } from '../types';
import { getObjectTitle } from '../types';

// =============================================================================
// Types
// =============================================================================

interface RegisteredObject {
  object: AnyObject;
  surfaceId: SurfaceId;
  registeredAt: number;
}

interface ObjectRegistryState {
  /** All registered objects by ID */
  objects: Map<string, RegisteredObject>;

  /** Object IDs grouped by surface */
  surfaceObjects: Map<SurfaceId, Set<string>>;

  /** Object IDs grouped by type */
  typeObjects: Map<ObjectType, Set<string>>;
}

interface ObjectRegistryContextValue {
  /** Register an object as visible */
  register: (object: AnyObject, surfaceId: SurfaceId) => void;

  /** Unregister an object */
  unregister: (id: string) => void;

  /** Get an object by ID */
  getObject: (id: string) => AnyObject | undefined;

  /** Get all objects of a type */
  getObjectsByType: (type: ObjectType) => AnyObject[];

  /** Get all objects in a surface */
  getObjectsInSurface: (surfaceId: SurfaceId) => AnyObject[];

  /** Get all registered objects */
  getAllObjects: () => AnyObject[];

  /** Search objects by query string */
  search: (query: string, options?: SearchOptions) => AnyObject[];

  /** Check if an object is registered */
  isRegistered: (id: string) => boolean;

  /** Get the surface an object is in */
  getSurface: (id: string) => SurfaceId | undefined;
}

interface SearchOptions {
  /** Limit results to specific types */
  types?: ObjectType[];
  /** Maximum number of results */
  limit?: number;
  /** Surface to search within */
  surfaceId?: SurfaceId;
}

// =============================================================================
// Context
// =============================================================================

const ObjectRegistryContext = createContext<ObjectRegistryContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface ObjectRegistryProviderProps {
  children: ReactNode;
}

export function ObjectRegistryProvider({ children }: ObjectRegistryProviderProps) {
  // Use ref for state to avoid re-renders on registration changes
  // Components that need to react to changes will use individual hooks
  const stateRef = useRef<ObjectRegistryState>({
    objects: new Map(),
    surfaceObjects: new Map(),
    typeObjects: new Map(),
  });

  // For forcing updates when needed
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notifyListeners = useCallback(() => {
    listenersRef.current.forEach((listener) => {
      listener();
    });
  }, []);

  const register = useCallback(
    (object: AnyObject, surfaceId: SurfaceId) => {
      const state = stateRef.current;
      const id = object.id;

      // If already registered in same surface, update
      const existing = state.objects.get(id);
      if (existing?.surfaceId === surfaceId) {
        existing.object = object;
        return;
      }

      // If registered in different surface, unregister first
      if (existing) {
        const oldSurfaceSet = state.surfaceObjects.get(existing.surfaceId);
        oldSurfaceSet?.delete(id);
      }

      // Register object
      state.objects.set(id, {
        object,
        surfaceId,
        registeredAt: Date.now(),
      });

      // Add to surface index
      let surfaceSet = state.surfaceObjects.get(surfaceId);
      if (!surfaceSet) {
        surfaceSet = new Set();
        state.surfaceObjects.set(surfaceId, surfaceSet);
      }
      surfaceSet.add(id);

      // Add to type index
      let typeSet = state.typeObjects.get(object.type);
      if (!typeSet) {
        typeSet = new Set();
        state.typeObjects.set(object.type, typeSet);
      }
      typeSet.add(id);

      notifyListeners();
    },
    [notifyListeners],
  );

  const unregister = useCallback(
    (id: string) => {
      const state = stateRef.current;
      const existing = state.objects.get(id);

      if (!existing) return;

      // Remove from objects
      state.objects.delete(id);

      // Remove from surface index
      const surfaceSet = state.surfaceObjects.get(existing.surfaceId);
      surfaceSet?.delete(id);

      // Remove from type index
      const typeSet = state.typeObjects.get(existing.object.type);
      typeSet?.delete(id);

      notifyListeners();
    },
    [notifyListeners],
  );

  const getObject = useCallback((id: string): AnyObject | undefined => {
    return stateRef.current.objects.get(id)?.object;
  }, []);

  const getObjectsByType = useCallback((type: ObjectType): AnyObject[] => {
    const state = stateRef.current;
    const typeSet = state.typeObjects.get(type);
    if (!typeSet) return [];

    return Array.from(typeSet)
      .map((id) => state.objects.get(id)?.object)
      .filter((obj): obj is AnyObject => obj !== undefined);
  }, []);

  const getObjectsInSurface = useCallback((surfaceId: SurfaceId): AnyObject[] => {
    const state = stateRef.current;
    const surfaceSet = state.surfaceObjects.get(surfaceId);
    if (!surfaceSet) return [];

    return Array.from(surfaceSet)
      .map((id) => state.objects.get(id)?.object)
      .filter((obj): obj is AnyObject => obj !== undefined);
  }, []);

  const getAllObjects = useCallback((): AnyObject[] => {
    return Array.from(stateRef.current.objects.values()).map((reg) => reg.object);
  }, []);

  const search = useCallback(
    (query: string, options: SearchOptions = {}): AnyObject[] => {
      const { types, limit = 50, surfaceId } = options;
      const normalizedQuery = query.toLowerCase().trim();

      if (!normalizedQuery) {
        return [];
      }

      let candidates: AnyObject[];

      // Get candidates based on filters
      if (surfaceId) {
        candidates = getObjectsInSurface(surfaceId);
      } else if (types && types.length > 0) {
        candidates = types.flatMap((type) => getObjectsByType(type));
      } else {
        candidates = getAllObjects();
      }

      // Filter by types if both surfaceId and types specified
      if (surfaceId && types && types.length > 0) {
        candidates = candidates.filter((obj) => types.includes(obj.type));
      }

      // Score and filter by query
      const scored = candidates
        .map((obj) => {
          const title = getObjectTitle(obj).toLowerCase();
          let score = 0;

          // Exact match
          if (title === normalizedQuery) {
            score = 100;
          }
          // Starts with
          else if (title.startsWith(normalizedQuery)) {
            score = 80;
          }
          // Contains
          else if (title.includes(normalizedQuery)) {
            score = 60;
          }
          // Fuzzy match (simple character matching)
          else {
            let queryIdx = 0;
            for (const char of title) {
              if (queryIdx < normalizedQuery.length && char === normalizedQuery[queryIdx]) {
                queryIdx++;
              }
            }
            if (queryIdx === normalizedQuery.length) {
              score = 40;
            }
          }

          return { object: obj, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

      return scored.slice(0, limit).map((item) => item.object);
    },
    [getAllObjects, getObjectsByType, getObjectsInSurface],
  );

  const isRegistered = useCallback((id: string): boolean => {
    return stateRef.current.objects.has(id);
  }, []);

  const getSurface = useCallback((id: string): SurfaceId | undefined => {
    return stateRef.current.objects.get(id)?.surfaceId;
  }, []);

  const value = useMemo(
    (): ObjectRegistryContextValue => ({
      register,
      unregister,
      getObject,
      getObjectsByType,
      getObjectsInSurface,
      getAllObjects,
      search,
      isRegistered,
      getSurface,
    }),
    [
      register,
      unregister,
      getObject,
      getObjectsByType,
      getObjectsInSurface,
      getAllObjects,
      search,
      isRegistered,
      getSurface,
    ],
  );

  return <ObjectRegistryContext.Provider value={value}>{children}</ObjectRegistryContext.Provider>;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Access the object registry.
 */
export function useObjectRegistry(): ObjectRegistryContextValue {
  const context = useContext(ObjectRegistryContext);
  if (!context) {
    throw new Error('useObjectRegistry must be used within an ObjectRegistryProvider');
  }
  return context;
}

/**
 * Search objects with automatic updates.
 */
export function useObjectSearch(query: string, options?: SearchOptions): AnyObject[] {
  const registry = useObjectRegistry();
  return useMemo(() => registry.search(query, options), [registry, query, options]);
}
