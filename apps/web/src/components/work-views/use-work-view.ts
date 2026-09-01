'use client';

import {
  FractionalRank,
  PersonalWorkViewState,
  type PersonalWorkViewState as PersonalWorkViewStateValue,
  type InitiativeWorkViewFacetRequest,
  type InitiativeWorkViewQueryRequest,
  type ProgramWorkViewFacetRequest,
  type ProgramWorkViewQueryRequest,
  type ProjectWorkViewFacetRequest,
  type ProjectWorkViewQueryRequest,
  type TaskWorkViewFacetRequest,
  type TaskWorkViewQueryRequest,
  type ViewInstanceKey,
  WorkViewFacetRequest,
  type WorkViewFacetRequest as WorkViewFacetRequestValue,
  WorkViewFacetResponse,
  type WorkViewFacetResponse as WorkViewFacetResponseValue,
  WorkViewQueryRequest,
  type WorkViewQueryRequest as WorkViewQueryRequestValue,
  WorkViewQueryResponse,
  type WorkViewQueryResponse as WorkViewQueryResponseValue,
} from '@docket/work/work-view-contract';
import { HubPreferences } from '@docket/planning/hub-preferences-contract';
import {
  OrganizationWorkViewDefault,
  OrganizationWorkViewDefaultBody,
  SavedWorkViewCreate,
  type SavedWorkViewCreate as SavedWorkViewCreateValue,
  type SavedWorkViewOut,
  SavedWorkViewOut as SavedWorkViewOutSchema,
} from '@docket/work/saved-view-contract';
import type { ViewTarget } from '@docket/work/view-contract';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { UserFacingError } from '@/lib/problem';
import {
  apiQueryOptions,
  apiInfiniteQueryOptions,
  type RpcResponse,
  queryKeys,
  rpcErrorResponse,
  unwrap,
  useApiListQuery,
  useInfiniteApiQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

import {
  type WorkViewDefinitionFor,
  type WorkViewFacetResponseForTarget,
  type WorkViewFilterFieldKey,
  type WorkViewFilterFor,
  type WorkViewFilterShape,
  parseWorkViewDefinition,
  removePersonalViewState,
  workViewFilterFieldCatalog,
} from './view-state';
import type { WorkViewGroupPage } from './renderer-types';
import {
  emptyWorkViewPages,
  mergeWorkViewPageRows,
  orderedWorkViewPages,
  reduceWorkViewPages,
  workViewPageForPath,
  type WorkViewPages,
} from './use-work-view-pages';

interface QueryRequestByTarget {
  readonly task: ReturnType<typeof TaskWorkViewQueryRequest.parse>;
  readonly project: ReturnType<typeof ProjectWorkViewQueryRequest.parse>;
  readonly program: ReturnType<typeof ProgramWorkViewQueryRequest.parse>;
  readonly initiative: ReturnType<typeof InitiativeWorkViewQueryRequest.parse>;
}
type QueryRequestFor<TTarget extends ViewTarget> = QueryRequestByTarget[TTarget];

interface FacetRequestByTarget {
  readonly task: ReturnType<typeof TaskWorkViewFacetRequest.parse>;
  readonly project: ReturnType<typeof ProjectWorkViewFacetRequest.parse>;
  readonly program: ReturnType<typeof ProgramWorkViewFacetRequest.parse>;
  readonly initiative: ReturnType<typeof InitiativeWorkViewFacetRequest.parse>;
}
type FacetRequestFor<TTarget extends ViewTarget> = FacetRequestByTarget[TTarget];
type SavedViewFor<TTarget extends ViewTarget> = Extract<
  SavedWorkViewOut,
  { readonly target: TTarget }
>;
interface QueryResponseByTarget {
  readonly task: Extract<WorkViewQueryResponseValue, { readonly target: 'task' }>;
  readonly project: Extract<WorkViewQueryResponseValue, { readonly target: 'project' }>;
  readonly program: Extract<WorkViewQueryResponseValue, { readonly target: 'program' }>;
  readonly initiative: Extract<WorkViewQueryResponseValue, { readonly target: 'initiative' }>;
}
type QueryResponseFor<TTarget extends ViewTarget> = QueryResponseByTarget[TTarget];

type FacetResponseFor<TTarget extends ViewTarget> = WorkViewFacetResponseForTarget<TTarget>;
type DefaultWorkViewInput = ReturnType<typeof OrganizationWorkViewDefaultBody.parse>;

interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

async function validatedRpcResponse<T>(
  call: () => Promise<RpcResponse<unknown>>,
  schema: RuntimeSchema<T>,
): Promise<RpcResponse<T>> {
  const response = await call();
  if (!response.ok) return rpcErrorResponse<T>(response);
  const value = schema.parse(await response.json());
  return {
    ok: true,
    status: response.status,
    json: async () => value,
  };
}

function parseQueryResponse<TTarget extends ViewTarget>(
  target: TTarget,
  value: unknown,
): QueryResponseFor<TTarget>;
function parseQueryResponse(target: ViewTarget, value: unknown): WorkViewQueryResponseValue {
  const parsed = WorkViewQueryResponse.parse(value);
  if (parsed.target !== target) {
    throw new UserFacingError('The server returned results for another work type.');
  }
  return parsed;
}

function parseQueryRequest<TTarget extends ViewTarget>(
  target: TTarget,
  value: unknown,
): QueryRequestFor<TTarget>;
function parseQueryRequest(target: ViewTarget, value: unknown): WorkViewQueryRequestValue {
  const parsed = WorkViewQueryRequest.parse(value);
  if (parsed.target !== target) {
    throw new UserFacingError('This query belongs to another work type.');
  }
  return parsed;
}

function parseFacetResponse<TTarget extends ViewTarget>(
  target: TTarget,
  value: unknown,
): FacetResponseFor<TTarget>;
function parseFacetResponse(target: ViewTarget, value: unknown): WorkViewFacetResponseValue {
  const parsed = WorkViewFacetResponse.parse(value);
  if (parsed.target !== target) {
    throw new UserFacingError('The server returned filters for another work type.');
  }
  return parsed;
}

function parseFacetRequest<TTarget extends ViewTarget>(
  target: TTarget,
  value: unknown,
): FacetRequestFor<TTarget>;
function parseFacetRequest(target: ViewTarget, value: unknown): WorkViewFacetRequestValue {
  const parsed = WorkViewFacetRequest.parse(value);
  if (parsed.target !== target) {
    throw new UserFacingError('This filter request belongs to another work type.');
  }
  return parsed;
}

function parseSavedViewResponse<TTarget extends ViewTarget>(
  target: TTarget,
  value: unknown,
): SavedViewFor<TTarget>;
function parseSavedViewResponse(target: ViewTarget, value: unknown): SavedWorkViewOut {
  const parsed = SavedWorkViewOutSchema.parse(value);
  if (parsed.target !== target) {
    throw new UserFacingError('The server saved a view for another work type.');
  }
  return parsed;
}

function parseDefaultResponse<TTarget extends ViewTarget>(
  target: TTarget,
  value: unknown,
): Extract<ReturnType<typeof OrganizationWorkViewDefault.parse>, { readonly target: TTarget }>;
function parseDefaultResponse(
  target: ViewTarget,
  value: unknown,
): ReturnType<typeof OrganizationWorkViewDefault.parse> {
  const parsed = OrganizationWorkViewDefault.parse(value);
  if (parsed.target !== target) {
    throw new UserFacingError('The server saved a default for another work type.');
  }
  return parsed;
}

function executionRequestKey(
  request: WorkViewQueryRequestValue | WorkViewFacetRequestValue,
): string {
  const definition = {
    version: request.definition.version,
    target: request.definition.target,
    filter: request.definition.filter,
    arrangement: request.definition.arrangement,
  };
  return JSON.stringify({ ...request, definition });
}

/** Target-safe inputs for one shared work-view controller instance. */
export interface UseWorkViewOptions<TTarget extends ViewTarget> {
  readonly organizationId: string;
  readonly target: TTarget;
  readonly instanceKey: ViewInstanceKey;
  readonly fallback: WorkViewDefinitionFor<TTarget>;
  readonly context: QueryRequestFor<TTarget>['context'];
  readonly savedView?: SavedViewFor<TTarget> | null;
  readonly temporaryFilter?: WorkViewFilterFor<TTarget> | null;
  /** Transient full-corpus text search that does not alter the durable view definition. */
  readonly search?: string;
  readonly limit?: number;
}

/** Input collected by the Save view action before the controller adds its typed state. */
export interface SaveWorkViewInput {
  readonly name: string;
  readonly scope?: SavedWorkViewCreateValue['scope'];
  readonly teamId?: SavedWorkViewCreateValue['teamId'];
  readonly position?: SavedWorkViewCreateValue['position'];
}

/** Data and mutations shared by every work-view page renderer. */
export interface WorkViewController<TTarget extends ViewTarget> {
  readonly timezone: string;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly effectiveDefinition: WorkViewDefinitionFor<TTarget>;
  readonly response: QueryResponseFor<TTarget> | undefined;
  readonly groupPages: readonly WorkViewGroupPage<TTarget>[];
  readonly collapsedGroups: ReadonlySet<string>;
  readonly hiddenBoardColumns: ReadonlySet<string>;
  readonly favoriteViewIds: ReadonlySet<string>;
  readonly facetResponse: WorkViewFacetResponseForTarget<TTarget> | undefined;
  readonly facetMetadataResponse: WorkViewFacetResponseForTarget<TTarget> | undefined;
  readonly loading: boolean;
  readonly loadingMoreRows: boolean;
  readonly retrying: boolean;
  readonly facetLoading: boolean;
  readonly facetHasMore: boolean;
  readonly facetLoadingMore: boolean;
  /** Initial roster failure. Cached rows remain visible for every other failure owner. */
  readonly initialError: unknown;
  /** Root continuation failure. Retry repeats the retained root cursor. */
  readonly rootContinuationError: unknown;
  /** Facet query failure owned by the filter builder. */
  readonly facetError: unknown;
  /** Personal view preference failure owned by the changed presentation control. */
  readonly preferencesError: unknown;
  /** Saved-view mutation failure owned by the open save dialog. */
  readonly saveError: unknown;
  /** Default mutation failure owned by the default action. */
  readonly defaultError: unknown;
  readonly saving: boolean;
  readonly settingDefault: boolean;
  readonly updatingPreferences: boolean;
  readonly setDefinition: (definition: WorkViewDefinitionFor<TTarget>) => void;
  readonly requestFacet: (field: WorkViewFilterFieldKey<TTarget>, search: string) => void;
  readonly loadMoreFacets: () => void;
  readonly loadMoreGroup: (path: readonly string[]) => void;
  readonly loadMoreRows: () => void;
  readonly retryInitial: () => void;
  readonly retryFacet: () => void;
  readonly retryPreferences: () => void;
  readonly toggleCollapsedGroup: (key: string) => void;
  readonly toggleHiddenBoardColumn: (key: string) => void;
  readonly showAllBoardColumns: () => void;
  readonly toggleFavoriteView: (viewId: string) => void;
  readonly resetPersonalOverride: () => void;
  readonly saveView: (input: SaveWorkViewInput) => Promise<void>;
  readonly setAsDefault: () => void;
}

function relationFilterFields<TTarget extends ViewTarget>(
  target: TTarget,
  filter: WorkViewFilterShape<TTarget> | null,
): readonly WorkViewFilterFieldKey<TTarget>[] {
  if (!filter) return [];
  const relationKeys = new Set(
    workViewFilterFieldCatalog(target)
      .filter((field) => field.kind === 'relation-one' || field.kind === 'relation-many')
      .map((field) => field.key),
  );
  const result: WorkViewFilterFieldKey<TTarget>[] = [];
  const visit = (node: WorkViewFilterShape<TTarget>): void => {
    if (node.kind === 'not') {
      visit(node.child);
      return;
    }
    if (node.kind === 'all' || node.kind === 'any') {
      for (const child of node.children) visit(child);
      return;
    }
    if (!('field' in node)) return;
    if (relationKeys.has(node.field) && !result.includes(node.field)) result.push(node.field);
  };
  visit(filter);
  return result;
}

function mergeFacetMetadata(
  target: ViewTarget,
  current: WorkViewFacetResponseValue | undefined,
  next: WorkViewFacetResponseValue,
): WorkViewFacetResponseValue {
  const buckets = new Map<
    string,
    {
      readonly field: string;
      readonly options: unknown[];
      readonly emptyCount: number;
      readonly nextCursor: string | null;
    }
  >();
  for (const bucket of [...(current?.buckets ?? []), ...next.buckets]) {
    const existing = buckets.get(bucket.field);
    const options = existing ? [...existing.options] : [];
    for (const option of bucket.options) {
      if (
        !options.some(
          (candidate) =>
            typeof candidate === 'object' &&
            candidate !== null &&
            'value' in candidate &&
            JSON.stringify(candidate.value) === JSON.stringify(option.value),
        )
      ) {
        options.push(option);
      }
    }
    buckets.set(bucket.field, {
      field: bucket.field,
      options,
      emptyCount: bucket.emptyCount,
      nextCursor: bucket.nextCursor,
    });
  }
  return WorkViewFacetResponse.parse({
    target,
    buckets: [...buckets.values()],
    distinctCount: next.distinctCount,
  });
}

function sameArrangementOrPresentation<TTarget extends ViewTarget>(
  left: WorkViewDefinitionFor<TTarget>,
  right: WorkViewDefinitionFor<TTarget>,
): boolean {
  return (
    JSON.stringify(left.arrangement) === JSON.stringify(right.arrangement) &&
    JSON.stringify(left.presentation) === JSON.stringify(right.presentation)
  );
}

function personalState<TTarget extends ViewTarget>(
  definition: WorkViewDefinitionFor<TTarget>,
  instanceKey: ViewInstanceKey,
  current?: PersonalWorkViewStateValue,
): PersonalWorkViewStateValue {
  return PersonalWorkViewState.parse({
    instanceKey,
    target: definition.target,
    arrangement: definition.arrangement,
    presentation: definition.presentation,
    collapsedGroups: current?.collapsedGroups ?? [],
    hiddenBoardColumns: current?.hiddenBoardColumns ?? [],
    favoriteViewIds: current?.favoriteViewIds ?? [],
    lastUsedLayout: definition.presentation.layout,
  });
}

/** Build the target-bound facet request used by the shared query layer. */
export function buildWorkViewFacetRequest<TTarget extends ViewTarget>(input: {
  readonly target: TTarget;
  readonly field: WorkViewFilterFieldKey<TTarget>;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly temporaryFilter: WorkViewFilterFor<TTarget> | null;
  readonly context: QueryRequestFor<TTarget>['context'];
  readonly search: string;
}): FacetRequestFor<TTarget> {
  return parseFacetRequest(input.target, {
    target: input.target,
    fields: [input.field],
    definition: input.definition,
    temporaryFilter: input.temporaryFilter,
    context: input.context,
    ...(input.search.trim() ? { search: input.search.trim() } : {}),
    limit: 50,
  });
}

/** Coordinate typed defaults, personal overrides, URL refinement, execution, and saves. */
export function useWorkView<TTarget extends ViewTarget>(
  options: UseWorkViewOptions<TTarget>,
): WorkViewController<TTarget> {
  const { organizationId, target, instanceKey } = options;
  const queryClient = useQueryClient();
  const preferencesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => validatedRpcResponse(() => api.v1.hub.preferences.$get(), HubPreferences),
      'Could not load your view preferences.',
    ),
  );
  const defaultQ = useApiQuery({
    ...apiQueryOptions<ReturnType<typeof OrganizationWorkViewDefault.parse> | null>(
      queryKeys.workViewDefault(organizationId, target),
      async () => {
        const response = await validatedRpcResponse(
          () =>
            api.v1.orgs[':orgId']['work-views'].defaults[':target'].$get({
              param: { orgId: organizationId, target },
            }),
          OrganizationWorkViewDefault,
        );
        if (response.status === 404) {
          return {
            ok: true,
            status: 200,
            json: async () => null,
          } satisfies RpcResponse<null>;
        }
        return response;
      },
      'Could not load the workspace view default.',
      { select: (value) => (value ? OrganizationWorkViewDefault.parse(value) : null) },
    ),
    enabled: options.savedView == null,
  });

  const persistedStates = preferencesQ.data?.viewState ?? [];
  const timezone = preferencesQ.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const persistedPersonal = persistedStates.find((state) => state.instanceKey === instanceKey);
  const controllerKey = `${target}:${instanceKey}`;
  const [workingState, setWorkingState] = useState<{
    readonly key: string;
    readonly definition: WorkViewDefinitionFor<TTarget>;
  } | null>(null);
  const [ignoredPersonalKey, setIgnoredPersonalKey] = useState<string | null>(null);
  const [facetState, setFacetState] = useState<{
    readonly key: string;
    readonly field: WorkViewFilterFieldKey<TTarget>;
    readonly search: string;
  } | null>(null);
  const [facetMetadataState, setFacetMetadataState] = useState<{
    readonly key: string;
    readonly response: WorkViewFacetResponseValue;
  } | null>(null);
  const [facetRetry, setFacetRetry] = useState<{
    readonly key: string;
    readonly operation: 'initial' | 'continuation';
  } | null>(null);
  const facetOperation = useRef<'initial' | 'continuation'>('initial');
  const [groupPageState, setGroupPageState] = useState<{
    readonly key: string;
    readonly pages: WorkViewPages<WorkViewGroupPage<TTarget>['rows'][number]>;
  } | null>(null);
  const [rootPageState, setRootPageState] = useState<{
    readonly key: string;
    readonly pages: WorkViewPages<WorkViewGroupPage<TTarget>['rows'][number]>;
  } | null>(null);
  const [personalExtrasState, setPersonalExtrasState] = useState<{
    readonly key: string;
    readonly collapsedGroups: readonly string[];
    readonly hiddenBoardColumns: readonly string[];
    readonly favoriteViewIds: readonly string[];
  } | null>(null);
  const workingDefinition = workingState?.key === controllerKey ? workingState.definition : null;
  const ignorePersistedPersonal = ignoredPersonalKey === controllerKey;
  const facetInput = facetState?.key === controllerKey ? facetState : null;

  const savedOrDefaultValue = options.savedView?.definition ?? defaultQ.data?.definition ?? null;
  const savedOrDefault =
    savedOrDefaultValue === null ? null : parseWorkViewDefinition(target, savedOrDefaultValue);
  const personal =
    !ignorePersistedPersonal && persistedPersonal?.target === target ? persistedPersonal : null;
  const durableDefinition = savedOrDefault ?? options.fallback;
  const resolvedDefinition = parseWorkViewDefinition(target, {
    ...durableDefinition,
    arrangement: {
      ...durableDefinition.arrangement,
      ...personal?.arrangement,
    },
    presentation: {
      ...durableDefinition.presentation,
      ...personal?.presentation,
    },
  });
  const definition = workingDefinition ?? resolvedDefinition;
  const activeExtras = personalExtrasState?.key === controllerKey ? personalExtrasState : null;
  const collapsedGroupValues = activeExtras?.collapsedGroups ?? personal?.collapsedGroups ?? [];
  const hiddenBoardColumnValues =
    activeExtras?.hiddenBoardColumns ?? personal?.hiddenBoardColumns ?? [];
  const persistedFavoriteViewIdValues = useMemo(
    () => [...new Set(persistedStates.flatMap((state) => state.favoriteViewIds))],
    [persistedStates],
  );
  const favoriteViewIdValues = activeExtras?.favoriteViewIds ?? persistedFavoriteViewIdValues;
  const effectiveDefinition = parseWorkViewDefinition(target, {
    ...definition,
    filter:
      definition.filter && options.temporaryFilter
        ? { kind: 'all', children: [definition.filter, options.temporaryFilter] }
        : (options.temporaryFilter ?? definition.filter),
  });
  const request = parseQueryRequest(target, {
    target,
    definition,
    temporaryFilter: options.temporaryFilter ?? null,
    context: options.savedView?.context ?? options.context,
    ...(options.search?.trim() ? { search: options.search.trim() } : {}),
    limit: options.limit ?? 100,
  });
  const requestKey = executionRequestKey(request);
  const executionKey = `${controllerKey}:${requestKey}:${timezone}`;
  const readyToQuery =
    !preferencesQ.isPending && (options.savedView != null || !defaultQ.isPending);
  const queryQ = useApiListQuery(
    apiQueryOptions<QueryResponseFor<TTarget>>(
      queryKeys.workView(organizationId, target, instanceKey, requestKey, timezone),
      () =>
        validatedRpcResponse(
          () =>
            api.v1.orgs[':orgId']['work-views'].query.$post({
              param: { orgId: organizationId },
              json: request,
            }),
          { parse: (value) => parseQueryResponse(target, value) },
        ),
      `Could not load ${target}s.`,
      { enabled: readyToQuery },
    ),
  );

  const fetchGroupPage = useCallback(
    async (path: readonly string[], cursor: string | null): Promise<void> => {
      setGroupPageState((current) => {
        const pages = current?.key === executionKey ? current.pages : emptyWorkViewPages();
        return {
          key: executionKey,
          pages: reduceWorkViewPages(pages, { type: 'request', path, cursor }),
        };
      });
      const pageRequest = parseQueryRequest(target, {
        ...request,
        groupPath: path,
        ...(cursor ? { cursor } : {}),
      });
      try {
        const page = await queryClient.fetchQuery(
          apiQueryOptions<QueryResponseFor<TTarget>>(
            queryKeys.workView(
              organizationId,
              target,
              instanceKey,
              executionRequestKey(pageRequest),
              timezone,
            ),
            () =>
              validatedRpcResponse(
                () =>
                  api.v1.orgs[':orgId']['work-views'].query.$post({
                    param: { orgId: organizationId },
                    json: pageRequest,
                  }),
                { parse: (value) => parseQueryResponse(target, value) },
              ),
            `Could not load ${target}s in this group.`,
          ),
        );
        setGroupPageState((current) => {
          if (current?.key !== executionKey) return current;
          // `parseQueryResponse` validated the target discriminator above. TypeScript cannot retain
          // that correlation through an indexed generic response union, so restore it at this one
          // target-checked boundary instead of weakening the renderer contract.
          const pageRows =
            page.rows as unknown as readonly WorkViewGroupPage<TTarget>['rows'][number][];
          return {
            ...current,
            pages: reduceWorkViewPages(current.pages, {
              type: 'success',
              path,
              cursor,
              rows: pageRows,
              nextCursor: page.nextCursor,
            }),
          };
        });
      } catch {
        setGroupPageState((current) =>
          current?.key === executionKey
            ? {
                ...current,
                pages: reduceWorkViewPages(current.pages, {
                  type: 'failure',
                  path,
                  cursor,
                  error: new UserFacingError(`Could not load ${target}s in this group.`),
                }),
              }
            : current,
        );
      }
    },
    [executionKey, instanceKey, organizationId, queryClient, request, target, timezone],
  );

  useEffect(() => {
    const response = queryQ.data;
    const groupField = definition.arrangement.groupBy as string | null;
    const subGroupField = definition.arrangement.subGroupBy as string | null;
    if (!response || groupField === null) return;
    const depth = subGroupField === null ? 1 : 2;
    const paths = response.groups
      .filter((group) => group.path.length === depth)
      .map((group) => group.path);
    const current =
      groupPageState?.key === executionKey ? groupPageState.pages : emptyWorkViewPages();
    for (const path of paths) {
      if (workViewPageForPath(current, path)) continue;
      void fetchGroupPage(path, null);
    }
  }, [
    definition.arrangement.groupBy,
    definition.arrangement.subGroupBy,
    executionKey,
    fetchGroupPage,
    groupPageState,
    queryQ.data,
  ]);

  const facetMetadataResponse =
    facetMetadataState?.key === controllerKey
      ? parseFacetResponse(target, facetMetadataState.response)
      : undefined;
  const implicitFacetInputs = relationFilterFields(target, definition.filter)
    .filter((field) => !facetMetadataResponse?.buckets.some((bucket) => bucket.field === field))
    .map((field) => ({ field, search: '' }));
  const activeFacetInput = facetInput ?? implicitFacetInputs[0] ?? null;
  const facetRequest = activeFacetInput
    ? buildWorkViewFacetRequest({
        target,
        field: activeFacetInput.field,
        definition,
        temporaryFilter: options.temporaryFilter ?? null,
        context: request.context,
        search: activeFacetInput.search,
      })
    : null;
  const facetRequestKey = facetRequest ? executionRequestKey(facetRequest) : 'idle';
  const facetQ = useInfiniteApiQuery(
    apiInfiniteQueryOptions<FacetResponseFor<TTarget>>(
      queryKeys.workViewFacets(organizationId, target, instanceKey, facetRequestKey, timezone),
      (cursor) => {
        if (!facetRequest) {
          throw new UserFacingError('Choose a filter field before loading its options.');
        }
        const pageRequest = parseFacetRequest(target, {
          ...facetRequest,
          ...(cursor ? { cursor } : {}),
        });
        return validatedRpcResponse(
          () =>
            api.v1.orgs[':orgId']['work-views'].facets.$post({
              param: { orgId: organizationId },
              json: pageRequest,
            }),
          { parse: (value) => parseFacetResponse(target, value) },
        );
      },
      (lastPage) =>
        lastPage.buckets.find((bucket) => bucket.nextCursor !== null)?.nextCursor ?? undefined,
      'Could not load filter options.',
      { enabled: readyToQuery && facetRequest !== null },
    ),
  );
  useEffect(() => {
    if (!facetQ.error) {
      setFacetRetry((current) => (current?.key === facetRequestKey ? null : current));
      return;
    }
    setFacetRetry({
      key: facetRequestKey,
      operation: facetOperation.current,
    });
  }, [facetQ.error, facetRequestKey]);
  const facetResponse = useMemo<FacetResponseFor<TTarget> | undefined>(() => {
    const pages = facetQ.data?.pages;
    if (!pages || pages.length === 0) return undefined;
    const first = pages[0];
    if (!first) return undefined;
    const buckets: unknown[] = first.buckets.map((bucket) => {
      const matching = pages.flatMap((page) =>
        page.buckets.filter((candidate) => candidate.field === bucket.field),
      );
      const options: unknown[] = [];
      for (const candidate of matching) options.push(...candidate.options);
      return {
        ...bucket,
        options,
        nextCursor: matching.at(-1)?.nextCursor ?? null,
      };
    });
    return parseFacetResponse(target, {
      target,
      buckets,
      distinctCount: first.distinctCount,
    });
  }, [facetQ.data?.pages, target]);

  useEffect(() => {
    if (!facetResponse) return;
    setFacetMetadataState((current) => ({
      key: controllerKey,
      response: mergeFacetMetadata(
        target,
        current?.key === controllerKey ? current.response : undefined,
        facetResponse,
      ),
    }));
  }, [controllerKey, facetResponse, target]);

  const preferenceMutation = useApiMutation<HubPreferences, readonly PersonalWorkViewStateValue[]>({
    mutationFn: (viewState) =>
      unwrap(
        () =>
          validatedRpcResponse(
            () => api.v1.hub.preferences.$patch({ json: { viewState: [...viewState] } }),
            HubPreferences,
          ),
        'Could not save your view preferences.',
      ),
    invalidateKeys: [queryKeys.hubPreferences()],
  });
  const preferenceQueue = useRef<Promise<void>>(Promise.resolve());
  const preferredStates = useRef<readonly PersonalWorkViewStateValue[]>(persistedStates);
  const queuedPreferenceWrites = useRef(0);
  const preferenceRevision = useRef(0);
  const [preferenceWritesPending, setPreferenceWritesPending] = useState(0);
  const [preferenceError, setPreferenceError] = useState<unknown>(null);
  const [failedPreferenceWrite, setFailedPreferenceWrite] = useState<{
    readonly input: readonly PersonalWorkViewStateValue[];
    readonly onLatestFailure: () => void;
  } | null>(null);

  useEffect(() => {
    if (queuedPreferenceWrites.current === 0) preferredStates.current = persistedStates;
  }, [persistedStates]);

  const enqueuePreferenceWrite = useCallback(
    (next: readonly PersonalWorkViewStateValue[], onLatestFailure: () => void): void => {
      const revision = preferenceRevision.current + 1;
      preferenceRevision.current = revision;
      preferredStates.current = next;
      queuedPreferenceWrites.current += 1;
      setPreferenceWritesPending((current) => current + 1);
      setPreferenceError(null);
      preferenceQueue.current = preferenceQueue.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const saved = await preferenceMutation.mutateAsync(next);
            preferredStates.current = saved.viewState ?? next;
            setPreferenceError(null);
            setFailedPreferenceWrite((current) => (current?.input === next ? null : current));
          } catch {
            setPreferenceError(new UserFacingError('Could not save your view preferences.'));
            setFailedPreferenceWrite({ input: next, onLatestFailure });
            if (preferenceRevision.current === revision) onLatestFailure();
          } finally {
            queuedPreferenceWrites.current -= 1;
            setPreferenceWritesPending((current) => Math.max(0, current - 1));
          }
        });
    },
    [preferenceMutation],
  );

  const saveMutation = useApiMutation<SavedWorkViewOut, SaveWorkViewInput>({
    mutationFn: async (input) => {
      const saveRequest = SavedWorkViewCreate.parse({
        target,
        name: input.name,
        scope: input.scope ?? 'personal',
        ...(input.teamId ? { teamId: input.teamId } : {}),
        position: FractionalRank.parse(input.position ?? 'a0'),
        context: options.savedView?.context ?? options.context,
        definition,
      });
      return unwrap(
        () =>
          validatedRpcResponse(
            () =>
              api.v1.orgs[':orgId']['saved-views'].$post({
                param: { orgId: organizationId },
                json: saveRequest,
              }),
            { parse: (value) => parseSavedViewResponse(target, value) },
          ),
        'Could not save this view.',
      );
    },
    invalidateKeys: [queryKeys.savedViews(organizationId)],
  });

  const defaultMutation = useApiMutation<
    ReturnType<typeof OrganizationWorkViewDefault.parse>,
    DefaultWorkViewInput
  >({
    mutationFn: async (body) => {
      return unwrap(
        () =>
          validatedRpcResponse(
            () =>
              api.v1.orgs[':orgId']['work-views'].defaults[':target'].$patch({
                param: { orgId: organizationId, target },
                json: body,
              }),
            { parse: (value) => parseDefaultResponse(target, value) },
          ),
        'Could not set the workspace view default.',
      );
    },
    invalidateKeys: [queryKeys.workViewDefault(organizationId, target)],
  });
  const [failedDefaultInput, setFailedDefaultInput] = useState<DefaultWorkViewInput | null>(null);

  const setDefinition = useCallback(
    (next: WorkViewDefinitionFor<TTarget>): void => {
      const parsed = parseWorkViewDefinition(target, next);
      setIgnoredPersonalKey(null);
      setWorkingState({ key: controllerKey, definition: parsed });
      if (!sameArrangementOrPresentation(parsed, definition)) {
        const nextPersonal = personalState(parsed, instanceKey, persistedPersonal);
        enqueuePreferenceWrite(
          [
            ...preferredStates.current.filter((state) => state.instanceKey !== instanceKey),
            nextPersonal,
          ],
          () => {
            setWorkingState((current) => (current?.key === controllerKey ? null : current));
            setIgnoredPersonalKey(null);
          },
        );
      }
    },
    [controllerKey, definition, enqueuePreferenceWrite, instanceKey, persistedPersonal, target],
  );

  const requestFacet = useCallback(
    (field: WorkViewFilterFieldKey<TTarget>, search: string): void => {
      facetOperation.current = 'initial';
      setFacetState((current) =>
        current?.key === controllerKey &&
        String(current.field) === String(field) &&
        current.search === search
          ? current
          : { key: controllerKey, field, search },
      );
    },
    [controllerKey],
  );

  const resetPersonalOverride = useCallback((): void => {
    setIgnoredPersonalKey(controllerKey);
    setWorkingState((current) => (current?.key === controllerKey ? null : current));
    enqueuePreferenceWrite(removePersonalViewState(preferredStates.current, instanceKey), () => {
      setIgnoredPersonalKey(null);
    });
  }, [controllerKey, enqueuePreferenceWrite, instanceKey]);

  const persistPersonalExtras = useCallback(
    (
      collapsedGroups: readonly string[],
      hiddenBoardColumns: readonly string[],
      favoriteViewIds: readonly string[],
    ): void => {
      setPersonalExtrasState({
        key: controllerKey,
        collapsedGroups,
        hiddenBoardColumns,
        favoriteViewIds,
      });
      const nextPersonal = PersonalWorkViewState.parse({
        ...personalState(definition, instanceKey, persistedPersonal),
        collapsedGroups,
        hiddenBoardColumns,
        favoriteViewIds,
      });
      enqueuePreferenceWrite(
        [
          ...preferredStates.current
            .filter((state) => state.instanceKey !== instanceKey)
            .map((state) => PersonalWorkViewState.parse({ ...state, favoriteViewIds })),
          nextPersonal,
        ],
        () => {
          setPersonalExtrasState((current) => (current?.key === controllerKey ? null : current));
        },
      );
    },
    [controllerKey, definition, enqueuePreferenceWrite, instanceKey, persistedPersonal],
  );

  const toggleCollapsedGroup = useCallback(
    (key: string): void => {
      const next = collapsedGroupValues.includes(key)
        ? collapsedGroupValues.filter((candidate) => candidate !== key)
        : [...collapsedGroupValues, key];
      persistPersonalExtras(next, hiddenBoardColumnValues, favoriteViewIdValues);
    },
    [collapsedGroupValues, favoriteViewIdValues, hiddenBoardColumnValues, persistPersonalExtras],
  );

  const toggleHiddenBoardColumn = useCallback(
    (key: string): void => {
      const next = hiddenBoardColumnValues.includes(key)
        ? hiddenBoardColumnValues.filter((candidate) => candidate !== key)
        : [...hiddenBoardColumnValues, key];
      persistPersonalExtras(collapsedGroupValues, next, favoriteViewIdValues);
    },
    [collapsedGroupValues, favoriteViewIdValues, hiddenBoardColumnValues, persistPersonalExtras],
  );

  const showAllBoardColumns = useCallback((): void => {
    persistPersonalExtras(collapsedGroupValues, [], favoriteViewIdValues);
  }, [collapsedGroupValues, favoriteViewIdValues, persistPersonalExtras]);

  const toggleFavoriteView = useCallback(
    (viewId: string): void => {
      const next = favoriteViewIdValues.includes(viewId)
        ? favoriteViewIdValues.filter((candidate) => candidate !== viewId)
        : [...favoriteViewIdValues, viewId];
      persistPersonalExtras(collapsedGroupValues, hiddenBoardColumnValues, next);
    },
    [collapsedGroupValues, favoriteViewIdValues, hiddenBoardColumnValues, persistPersonalExtras],
  );

  const loadMoreFacets = useCallback((): void => {
    if (facetQ.hasNextPage && !facetQ.isFetchingNextPage) {
      facetOperation.current = 'continuation';
      void facetQ.fetchNextPage();
    }
  }, [facetQ]);

  const retryFacet = useCallback((): void => {
    const operation =
      facetRetry?.key === facetRequestKey ? facetRetry.operation : facetOperation.current;
    if (operation === 'continuation') {
      void facetQ.fetchNextPage();
      return;
    }
    void facetQ.refetch();
  }, [facetQ, facetRequestKey, facetRetry]);

  const loadMoreGroup = useCallback(
    (path: readonly string[]): void => {
      const page =
        groupPageState?.key === executionKey
          ? workViewPageForPath(groupPageState.pages, path)
          : undefined;
      if (!page || page.loading) return;
      const cursor = page.error ? page.retryCursor : page.nextCursor;
      if (cursor === null && !page.error) return;
      void fetchGroupPage(path, cursor ?? null);
    },
    [executionKey, fetchGroupPage, groupPageState],
  );

  const loadMoreRows = useCallback((): void => {
    const response = queryQ.data;
    const pages = rootPageState?.key === executionKey ? rootPageState.pages : emptyWorkViewPages();
    const current = workViewPageForPath(pages, []);
    const cursor = current?.nextCursor ?? response?.nextCursor ?? null;
    const groupField = definition.arrangement.groupBy as string | null;
    if (!response || groupField !== null || cursor === null || current?.loading === true) return;
    setRootPageState({
      key: executionKey,
      pages: reduceWorkViewPages(pages, { type: 'request', path: [], cursor }),
    });
    const pageRequest = parseQueryRequest(target, { ...request, cursor });
    void queryClient
      .fetchQuery(
        apiQueryOptions<QueryResponseFor<TTarget>>(
          queryKeys.workView(
            organizationId,
            target,
            instanceKey,
            JSON.stringify(pageRequest),
            timezone,
          ),
          () =>
            validatedRpcResponse(
              () =>
                api.v1.orgs[':orgId']['work-views'].query.$post({
                  param: { orgId: organizationId },
                  json: pageRequest,
                }),
              { parse: (value) => parseQueryResponse(target, value) },
            ),
          `Could not load more ${target}s.`,
        ),
      )
      .then((page) => {
        const pageRows =
          page.rows as unknown as readonly WorkViewGroupPage<TTarget>['rows'][number][];
        setRootPageState((latest) =>
          latest?.key === executionKey
            ? {
                ...latest,
                pages: reduceWorkViewPages(latest.pages, {
                  type: 'success',
                  path: [],
                  cursor,
                  rows: pageRows,
                  nextCursor: page.nextCursor,
                }),
              }
            : latest,
        );
      })
      .catch(() => {
        setRootPageState((latest) =>
          latest?.key === executionKey
            ? {
                ...latest,
                pages: reduceWorkViewPages(latest.pages, {
                  type: 'failure',
                  path: [],
                  cursor,
                  error: new UserFacingError(`Could not load more ${target}s.`),
                }),
              }
            : latest,
        );
      });
  }, [
    definition.arrangement.groupBy,
    executionKey,
    instanceKey,
    organizationId,
    queryClient,
    queryQ.data,
    request,
    rootPageState,
    target,
    timezone,
  ]);

  const retryInitial = useCallback((): void => {
    void queryQ.refetch();
  }, [queryQ]);

  const response = useMemo<QueryResponseFor<TTarget> | undefined>(() => {
    const first = queryQ.isPlaceholderData ? undefined : queryQ.data;
    const continuation =
      rootPageState?.key === executionKey ? workViewPageForPath(rootPageState.pages, []) : null;
    if (!first || !continuation) return first;
    return {
      ...first,
      rows: mergeWorkViewPageRows(
        first.rows,
        continuation.rows,
      ) as QueryResponseFor<TTarget>['rows'],
      nextCursor: continuation.nextCursor,
    };
  }, [executionKey, queryQ.data, queryQ.isPlaceholderData, rootPageState]);

  return useMemo(
    () => ({
      timezone,
      definition,
      effectiveDefinition,
      response,
      groupPages:
        groupPageState?.key === executionKey
          ? orderedWorkViewPages(queryQ.data?.groups ?? [], groupPageState.pages).map((page) => ({
              path: page.path,
              rows: page.rows,
              nextCursor: page.nextCursor,
              loading: page.loading,
              retryCursor: page.retryCursor,
              error: page.error,
            }))
          : [],
      collapsedGroups: new Set(collapsedGroupValues),
      hiddenBoardColumns: new Set(hiddenBoardColumnValues),
      favoriteViewIds: new Set(favoriteViewIdValues),
      facetResponse,
      facetMetadataResponse,
      loading: !readyToQuery || queryQ.isPending,
      loadingMoreRows:
        rootPageState?.key === executionKey &&
        (workViewPageForPath(rootPageState.pages, [])?.loading ?? false),
      retrying: queryQ.isFetching && queryQ.isError,
      facetLoading: facetQ.isPending,
      facetHasMore: facetQ.hasNextPage,
      facetLoadingMore: facetQ.isFetchingNextPage,
      initialError: queryQ.error,
      rootContinuationError:
        rootPageState?.key === executionKey
          ? (workViewPageForPath(rootPageState.pages, [])?.error ?? null)
          : null,
      facetError: facetQ.error,
      preferencesError: preferenceError ?? preferencesQ.error,
      saveError: saveMutation.error,
      defaultError: defaultMutation.error,
      saving: saveMutation.isPending,
      settingDefault: defaultMutation.isPending,
      updatingPreferences: preferenceWritesPending > 0,
      setDefinition,
      requestFacet,
      loadMoreFacets,
      loadMoreGroup,
      loadMoreRows,
      retryInitial,
      retryFacet,
      retryPreferences: () => {
        if (preferencesQ.error) {
          void preferencesQ.refetch();
          return;
        }
        if (!failedPreferenceWrite) return;
        enqueuePreferenceWrite(failedPreferenceWrite.input, failedPreferenceWrite.onLatestFailure);
      },
      toggleCollapsedGroup,
      toggleHiddenBoardColumn,
      showAllBoardColumns,
      toggleFavoriteView,
      resetPersonalOverride,
      saveView: async (input) => {
        await saveMutation.mutateAsync(input);
      },
      setAsDefault: () => {
        const input = failedDefaultInput ?? OrganizationWorkViewDefaultBody.parse({ definition });
        void defaultMutation
          .mutateAsync(input)
          .then(() => {
            setFailedDefaultInput(null);
          })
          .catch(() => {
            setFailedDefaultInput(input);
          });
      },
    }),
    [
      defaultMutation,
      defaultQ.error,
      collapsedGroupValues,
      definition,
      effectiveDefinition,
      facetQ.data,
      facetQ.error,
      facetQ.fetchNextPage,
      facetQ.hasNextPage,
      facetQ.isFetchingNextPage,
      facetQ.isPending,
      facetResponse,
      facetMetadataResponse,
      favoriteViewIdValues,
      executionKey,
      groupPageState,
      hiddenBoardColumnValues,
      loadMoreFacets,
      loadMoreGroup,
      loadMoreRows,
      preferenceError,
      failedPreferenceWrite,
      failedDefaultInput,
      preferenceWritesPending,
      preferencesQ.error,
      preferencesQ.refetch,
      queryQ.data,
      queryQ.error,
      queryQ.isPending,
      queryQ.isFetching,
      queryQ.isError,
      readyToQuery,
      response,
      rootPageState,
      retryInitial,
      retryFacet,
      showAllBoardColumns,
      requestFacet,
      resetPersonalOverride,
      saveMutation.isPending,
      saveMutation.error,
      saveMutation.mutateAsync,
      setDefinition,
      timezone,
      toggleCollapsedGroup,
      toggleFavoriteView,
      toggleHiddenBoardColumn,
      defaultMutation.error,
      defaultMutation.mutateAsync,
      enqueuePreferenceWrite,
    ],
  );
}
