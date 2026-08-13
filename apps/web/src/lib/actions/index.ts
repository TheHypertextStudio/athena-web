/**
 * `@/lib/actions` — the interaction contract's action half.
 *
 * @remarks
 * One import path for the object descriptor registry, the cursor contract, the universal action
 * handler, and the provider that mounts them. Surfaces should import from here rather than
 * reaching into individual modules, so the contract's surface area stays visible in one place.
 *
 * @see {@link @/components/dnd} for drag sources and drop targets.
 * @see {@link @/components/selection} for the multi-select model.
 * @see {@link @/components/context-menu} for the global right-click menu.
 */
export {
  CURSOR_CLICKABLE,
  CURSOR_DISABLED,
  CURSOR_DRAGGABLE,
  CURSOR_DROP_STATE,
  CURSOR_TEXT,
  type InteractionCursorState,
  interactionCursor,
} from './cursor';
export { InteractionProvider, type InteractionProviderProps } from './interaction-provider';
export {
  describeObject,
  isObjectKind,
  isSameObject,
  OBJECT_DESCRIPTORS,
  OBJECT_KINDS,
  OBJECT_TARGET_SELECTOR,
  type ObjectDescriptor,
  type ObjectKind,
  type ObjectMeta,
  type ObjectRef,
  type ObjectTargetProps,
  objectHref,
  objectKey,
  objectMetaString,
  objectTargetProps,
  parseObjectKey,
  readObjectTarget,
} from './object';
export {
  type ActionRegistry,
  type ActionRegistryOptions,
  type ActionReceiptRuntime,
  type ActionAsyncObservation,
  type ActionRegistrySnapshot,
  createActionRegistry,
  defineActionDomain,
  DuplicateActionIdError,
  DuplicateDomainRegistrationError,
  MalformedActionIdError,
  UnknownActionError,
} from './registry';
export {
  ActionRegistryProvider,
  type ActionRegistryProviderProps,
  useActionDispatch,
  useActionRegistry,
  useRegisterActionDomain,
  useResolvedActions,
} from './registry-context';
export {
  ACTION_SECTION_ORDER,
  type ActionContext,
  type ActionContextResolver,
  type ActionDefinition,
  type ActionDefinitionInput,
  type ActionDomain,
  type ActionId,
  type ActionInvocationResult,
  type ActionSection,
  type AsynchronousActionRun,
  type ActionResponsiveness,
  type ActionSource,
  type SynchronousActionRun,
  type ValidActionDefinition,
  type ResolvedAction,
} from './types';
