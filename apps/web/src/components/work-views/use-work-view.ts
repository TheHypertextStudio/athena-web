'use client';

import {
  FractionalRank,
  HubPreferences,
  OrganizationWorkViewDefault,
  OrganizationWorkViewDefaultBody,
  PersonalWorkViewState,
  type PersonalWorkViewState as PersonalWorkViewStateValue,
  SavedWorkViewCreate,
  type SavedWorkViewCreate as SavedWorkViewCreateValue,
  type SavedWorkViewOut,
  SavedWorkViewOut as SavedWorkViewOutSchema,
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
} from '@docket/types';
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

/** Target-safe inputs for one shared work-view controller instance. */
export interface UseWorkViewOptions<TTarget extends ViewTarget> {
  readonly organizationId: string;
  readonly target: TTarget;
  readonly instanceKey: ViewInstanceKey;
  readonly fallback: WorkViewDefinitionFor<TTarget>;
  readonly context: QueryRequestFor<TTarget>['context'];
  readonly savedView?: SavedViewFor<TTarget> | null;
  readonly temporaryFilter?: WorkViewFilterFor<TTarget> | null;
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
  readonly facetResponse: WorkViewFacetResponseForTarget<TTarget> | undefined;
  readonly facetMetadataResponse: WorkViewFacetResponseForTarget<TTarget> | undefined;
  readonly loading: boolean;
  readonly facetLoading: boolean;
  readonly facetHasMore: boolean;
  readonly facetLoadingMore: boolean;
  readonly error: unknown;
  readonly saving: boolean;
  readonly settingDefault: boolean;
  readonly updatingPreferences: boolean;
  readonly setDefinition: (definition: WorkViewDefinitionFor<TTarget>) => void;
  readonly requestFacet: (field: WorkViewFilterFieldKey<TTarget>, search: string) => void;
  readonly loadMoreFacets: () => void;
  readonly loadMoreGroup: (path: readonly string[]) => void;
  readonly resetPersonalOverride: () => void;
  readonly saveView: (input: SaveWorkViewInput) => void;
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
  const [groupPageState, setGroupPageState] = useState<{
    readonly key: string;
    readonly pages: readonly WorkViewGroupPage<TTarget>[];
    readonly error: unknown;
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
    limit: options.limit ?? 100,
  });
  const requestKey = JSON.stringify(request);
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
      const pathKey = JSON.stringify(path);
      setGroupPageState((current) => {
        const pages = current?.key === executionKey ? current.pages : [];
        const existing = pages.find((page) => JSON.stringify(page.path) === pathKey);
        const nextPage: WorkViewGroupPage<TTarget> = {
          path,
          rows: existing?.rows ?? [],
          nextCursor: existing?.nextCursor ?? null,
          loading: true,
        };
        return {
          key: executionKey,
          error: null,
          pages: [...pages.filter((page) => JSON.stringify(page.path) !== pathKey), nextPage],
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
            `Could not load ${target}s in this group.`,
          ),
        );
        setGroupPageState((current) => {
          if (current?.key !== executionKey) return current;
          const existing = current.pages.find(
            (candidate) => JSON.stringify(candidate.path) === pathKey,
          );
          // `parseQueryResponse` validated the target discriminator above. TypeScript cannot retain
          // that correlation through an indexed generic response union, so restore it at this one
          // target-checked boundary instead of weakening the renderer contract.
          const pageRows =
            page.rows as unknown as readonly WorkViewGroupPage<TTarget>['rows'][number][];
          const combined = cursor
            ? [...(existing?.rows ?? []), ...pageRows].filter(
                (row, index, all) =>
                  all.findIndex((candidate) => candidate.id === row.id) === index,
              )
            : pageRows;
          return {
            ...current,
            pages: [
              ...current.pages.filter((candidate) => JSON.stringify(candidate.path) !== pathKey),
              { path, rows: combined, nextCursor: page.nextCursor, loading: false },
            ],
          };
        });
      } catch {
        setGroupPageState((current) =>
          current?.key === executionKey
            ? {
                ...current,
                error: new UserFacingError(`Could not load ${target}s in this group.`),
                pages: current.pages.map((page) =>
                  JSON.stringify(page.path) === pathKey ? { ...page, loading: false } : page,
                ),
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
    const current = groupPageState?.key === executionKey ? groupPageState.pages : [];
    for (const path of paths) {
      if (current.some((page) => JSON.stringify(page.path) === JSON.stringify(path))) continue;
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
  const facetRequestKey = facetRequest ? JSON.stringify(facetRequest) : 'idle';
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
          } catch {
            setPreferenceError(new UserFacingError('Could not save your view preferences.'));
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
    undefined
  >({
    mutationFn: async () => {
      const body = OrganizationWorkViewDefaultBody.parse({ definition });
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

  const loadMoreFacets = useCallback((): void => {
    if (facetQ.hasNextPage && !facetQ.isFetchingNextPage) {
      void facetQ.fetchNextPage();
    }
  }, [facetQ]);

  const loadMoreGroup = useCallback(
    (path: readonly string[]): void => {
      const page =
        groupPageState?.key === executionKey
          ? groupPageState.pages.find(
              (candidate) => JSON.stringify(candidate.path) === JSON.stringify(path),
            )
          : undefined;
      if (!page || page.loading || page.nextCursor === null) return;
      void fetchGroupPage(path, page.nextCursor);
    },
    [executionKey, fetchGroupPage, groupPageState],
  );

  return useMemo(
    () => ({
      timezone,
      definition,
      effectiveDefinition,
      response: queryQ.isPlaceholderData ? undefined : queryQ.data,
      groupPages: groupPageState?.key === executionKey ? groupPageState.pages : [],
      facetResponse,
      facetMetadataResponse,
      loading: !readyToQuery || queryQ.isPending,
      facetLoading: facetQ.isPending,
      facetHasMore: facetQ.hasNextPage,
      facetLoadingMore: facetQ.isFetchingNextPage,
      error:
        queryQ.error ??
        (groupPageState?.key === executionKey ? groupPageState.error : null) ??
        facetQ.error ??
        preferenceError ??
        saveMutation.error ??
        defaultMutation.error ??
        preferencesQ.error ??
        defaultQ.error,
      saving: saveMutation.isPending,
      settingDefault: defaultMutation.isPending,
      updatingPreferences: preferenceWritesPending > 0,
      setDefinition,
      requestFacet,
      loadMoreFacets,
      loadMoreGroup,
      resetPersonalOverride,
      saveView: saveMutation.mutate,
      setAsDefault: () => {
        defaultMutation.mutate(undefined);
      },
    }),
    [
      defaultMutation,
      defaultQ.error,
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
      executionKey,
      groupPageState,
      loadMoreFacets,
      loadMoreGroup,
      preferenceError,
      preferenceWritesPending,
      preferencesQ.error,
      queryQ.data,
      queryQ.error,
      queryQ.isPending,
      readyToQuery,
      requestFacet,
      resetPersonalOverride,
      saveMutation.isPending,
      saveMutation.error,
      saveMutation.mutate,
      setDefinition,
      timezone,
      defaultMutation.error,
    ],
  );
}
