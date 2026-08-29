'use client';

import { Filter, Plus, X } from '@docket/ui/icons';
import {
  Button,
  Checkbox,
  ControlGroup,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Row,
  Select,
  Stack,
  Surface,
  Text,
} from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { fromLocalInputValue, toLocalInputValue } from '@/components/calendar/datetime-input';

import {
  parseFilterDraft,
  type WorkViewFacetResponseForTarget,
  type WorkViewFilterDraftFor,
  type WorkViewFilterFieldKey,
  type WorkViewFilterFor,
  type WorkViewFilterShape,
  workViewFilterFieldCatalog,
} from './view-state';
import { workViewPopoverItem, workViewPopoverSeparator } from './work-view-popover-styles';

type DraftGroup<TTarget extends ViewTarget> = Extract<
  WorkViewFilterDraftFor<TTarget>,
  { readonly kind: 'group' }
>;

const SET_OPERATORS = new Set([
  'isAnyOf',
  'isNoneOf',
  'includesAny',
  'includesAll',
  'includesNone',
]);

const DATE_PRESETS = [
  'today',
  'yesterday',
  'tomorrow',
  'this-week',
  'next-week',
  'last-week',
  'this-month',
  'next-month',
  'last-month',
] as const;
const RELATIVE_UNITS = ['day', 'week', 'month', 'quarter', 'year'] as const;
const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Props for the shared simple and advanced filter editor. */
export interface FilterBuilderProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly filter?: WorkViewFilterFor<TTarget> | null;
  readonly timezone?: string;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly trigger?: ReactNode;
  readonly onApply: (filter: WorkViewFilterFor<TTarget>) => void;
  readonly facetResponse?: WorkViewFacetResponseForTarget<TTarget> | undefined;
  readonly facetLoading?: boolean;
  readonly facetHasMore?: boolean;
  readonly facetLoadingMore?: boolean;
  readonly onFacetLoadMore?: (() => void) | undefined;
  readonly onFacetRequest?:
    ((field: WorkViewFilterFieldKey<TTarget>, search: string) => void) | undefined;
}

function emptyPredicate<TTarget extends ViewTarget>(): WorkViewFilterDraftFor<TTarget> {
  return { kind: 'predicate', field: null, operator: null };
}

function labelTarget(target: ViewTarget): string {
  return target === 'initiative' ? 'initiatives' : `${target}s`;
}

function operatorLabel(operator: string): string {
  const words = operator
    .replace(/-/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function pathKey(path: readonly number[]): string {
  return path.length === 0 ? 'root' : path.join('.');
}

function replaceDraft<TTarget extends ViewTarget>(
  draft: WorkViewFilterDraftFor<TTarget>,
  path: readonly number[],
  replacement: WorkViewFilterDraftFor<TTarget>,
): WorkViewFilterDraftFor<TTarget> {
  if (path.length === 0) return replacement;
  if (draft.kind !== 'group') return draft;
  const [head, ...rest] = path;
  return {
    ...draft,
    children: draft.children.map((child, index) =>
      index === head ? replaceDraft(child, rest, replacement) : child,
    ),
  };
}

function removeDraft<TTarget extends ViewTarget>(
  draft: DraftGroup<TTarget>,
  path: readonly number[],
): DraftGroup<TTarget> {
  const [head, ...rest] = path;
  if (head === undefined) return draft;
  if (rest.length === 0) {
    return { ...draft, children: draft.children.filter((_, index) => index !== head) };
  }
  return {
    ...draft,
    children: draft.children.map((child, index) => {
      if (index !== head || child.kind !== 'group') return child;
      return removeDraft(child, rest);
    }),
  };
}

function appendDraft<TTarget extends ViewTarget>(
  draft: DraftGroup<TTarget>,
  path: readonly number[],
  child: WorkViewFilterDraftFor<TTarget>,
): DraftGroup<TTarget> {
  if (path.length === 0) return { ...draft, children: [...draft.children, child] };
  const [head, ...rest] = path;
  return {
    ...draft,
    children: draft.children.map((current, index) => {
      if (index !== head || current.kind !== 'group') return current;
      return appendDraft(current, rest, child);
    }),
  };
}

function inputOperand(kind: string, raw: string, timezone: string): unknown {
  if (raw === '') return undefined;
  if (kind === 'number') return Number(raw);
  if (kind === 'date') return { kind: 'absolute', value: raw };
  if (kind === 'datetime') {
    const instant = fromLocalInputValue(raw, timezone);
    return instant ? { kind: 'absolute', value: instant } : undefined;
  }
  return raw;
}

function inputValue(operand: unknown, kind?: string, timezone?: string): string {
  if (typeof operand === 'string' || typeof operand === 'number') return String(operand);
  if (typeof operand === 'object' && operand !== null && 'value' in operand) {
    const value = operand.value;
    if (typeof value !== 'string') return '';
    return kind === 'datetime' && timezone ? toLocalInputValue(value, timezone) : value;
  }
  return '';
}

function temporalOperandKind(operand: unknown): 'absolute' | 'preset' | 'relative' {
  if (typeof operand !== 'object' || operand === null || !('kind' in operand)) return 'absolute';
  return operand.kind === 'preset' || operand.kind === 'relative' ? operand.kind : 'absolute';
}

function hasProperty(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key);
}

function taggedString(operand: unknown, key: string, fallback: string): string {
  if (!hasProperty(operand, key)) return fallback;
  const value = operand[key];
  return typeof value === 'string' ? value : fallback;
}

function taggedNumber(operand: unknown, key: string, fallback: number): number {
  if (!hasProperty(operand, key)) return fallback;
  const value = operand[key];
  return typeof value === 'number' ? value : fallback;
}

function taggedInput(operand: unknown, key: string, fallback: string): string {
  if (!hasProperty(operand, key)) return fallback;
  const value = operand[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function selectedOperand(operand: unknown, value: unknown): boolean {
  const values = operandValues(operand);
  const key = JSON.stringify(value);
  return values.some((current) => JSON.stringify(current) === key);
}

function operandValues(operand: unknown): readonly unknown[] {
  if (Array.isArray(operand)) return operand.map((value: unknown) => value);
  return operand === undefined ? [] : [operand];
}

function sameKey(left: unknown, right: unknown): boolean {
  return left === right;
}

function controlValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstValue<T>(values: readonly T[]): T | null {
  return values.length === 0 ? null : (values[0] ?? null);
}

interface TemporalOperandEditorProps {
  readonly fieldKind: 'date' | 'datetime';
  readonly label: string;
  readonly modeLabel: string;
  readonly operand: unknown;
  readonly timezone: string;
  readonly onChange: (operand: unknown) => void;
}

function TemporalOperandEditor({
  fieldKind,
  label,
  modeLabel,
  operand,
  timezone,
  onChange,
}: TemporalOperandEditorProps): ReactElement {
  const mode = temporalOperandKind(operand);
  const relativeOperand = useRef<unknown>(
    mode === 'relative' ? operand : { kind: 'relative', anchor: 'today', unit: 'day', offset: 0 },
  );

  function commitRelative(next: unknown): void {
    relativeOperand.current = next;
    onChange(next);
  }

  return (
    <ControlGroup controlSize="sm">
      <Select
        aria-label={modeLabel}
        value={mode}
        onChange={(event) => {
          if (event.target.value === 'preset') {
            onChange({ kind: 'preset', value: 'today' });
            return;
          }
          if (event.target.value === 'relative') {
            onChange(relativeOperand.current);
            return;
          }
          onChange(undefined);
        }}
      >
        <option value="absolute">Exact date and time</option>
        <option value="preset">Named range</option>
        <option value="relative">Relative offset</option>
      </Select>
      {mode === 'preset' ? (
        <Select
          aria-label="Date preset"
          value={taggedString(operand, 'value', 'today')}
          onChange={(event) => {
            onChange({ kind: 'preset', value: event.target.value });
          }}
        >
          {DATE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {operatorLabel(preset)}
            </option>
          ))}
        </Select>
      ) : null}
      {mode === 'relative' ? (
        <>
          <Select
            aria-label="Relative anchor"
            value={taggedString(operand, 'anchor', 'today')}
            onChange={(event) => {
              commitRelative({
                kind: 'relative',
                anchor: event.target.value,
                unit: taggedString(operand, 'unit', 'day'),
                offset: taggedNumber(operand, 'offset', 0),
              });
            }}
          >
            <option value="today">Today</option>
            <option value="now">Now</option>
          </Select>
          <Select
            aria-label="Relative unit"
            value={taggedString(operand, 'unit', 'day')}
            onChange={(event) => {
              commitRelative({
                kind: 'relative',
                anchor: taggedString(operand, 'anchor', 'today'),
                unit: event.target.value,
                offset: taggedNumber(operand, 'offset', 0),
              });
            }}
          >
            {RELATIVE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {operatorLabel(unit)}
              </option>
            ))}
          </Select>
          <Input
            variant="filled"
            type="text"
            inputMode="numeric"
            aria-label="Relative offset"
            value={taggedInput(operand, 'offset', '0')}
            onChange={(event) => {
              const rawOffset = event.target.value;
              const offset = Number(rawOffset);
              commitRelative({
                kind: 'relative',
                anchor: taggedString(operand, 'anchor', 'today'),
                unit: taggedString(operand, 'unit', 'day'),
                offset: rawOffset.trim() !== '' && Number.isInteger(offset) ? offset : rawOffset,
              });
            }}
          />
        </>
      ) : null}
      {mode === 'absolute' ? (
        <Input
          variant="filled"
          aria-label={label}
          type={fieldKind === 'datetime' ? 'datetime-local' : 'date'}
          value={inputValue(operand, fieldKind, timezone)}
          onChange={(event) => {
            onChange(inputOperand(fieldKind, event.target.value, timezone));
          }}
        />
      ) : null}
    </ControlGroup>
  );
}

interface DraftIdentity {
  readonly id: string;
  readonly children: readonly DraftIdentity[];
}

interface SeededDraft<TTarget extends ViewTarget> {
  readonly draft: WorkViewFilterDraftFor<TTarget>;
  readonly identity: DraftIdentity;
  readonly negatedNodeIds: ReadonlySet<string>;
}

function seedDraftNode<TTarget extends ViewTarget>(
  filter: WorkViewFilterShape<TTarget>,
  allocateId: () => string,
): SeededDraft<TTarget> {
  if (filter.kind === 'not') {
    const child = seedDraftNode(filter.child, allocateId);
    return {
      ...child,
      negatedNodeIds: new Set([...child.negatedNodeIds, child.identity.id]),
    };
  }
  if (filter.kind === 'all' || filter.kind === 'any') {
    const children = filter.children.map((child) => seedDraftNode(child, allocateId));
    return {
      draft: {
        kind: 'group',
        join: filter.kind,
        children: children.map((child) => child.draft),
      },
      identity: {
        id: allocateId(),
        children: children.map((child) => child.identity),
      },
      negatedNodeIds: new Set(children.flatMap((child) => [...child.negatedNodeIds])),
    };
  }
  if (!('field' in filter)) {
    throw new Error('A validated filter node must be a group, not, or predicate.');
  }
  return {
    draft: {
      kind: 'predicate',
      field: filter.field,
      operator: filter.operator,
      ...('operand' in filter ? { operand: filter.operand } : {}),
    },
    identity: { id: allocateId(), children: [] },
    negatedNodeIds: new Set(),
  };
}

function seedEditor<TTarget extends ViewTarget>(
  filter: WorkViewFilterFor<TTarget> | null | undefined,
  allocateId: () => string,
): {
  readonly draft: DraftGroup<TTarget>;
  readonly identity: DraftIdentity;
  readonly negatedNodeIds: ReadonlySet<string>;
} {
  if (!filter) {
    const draft: DraftGroup<TTarget> = {
      kind: 'group',
      join: 'all',
      children: [emptyPredicate<TTarget>()],
    };
    return {
      draft,
      identity: identityForDraft(draft, allocateId),
      negatedNodeIds: new Set(),
    };
  }
  const seeded = seedDraftNode(filter, allocateId);
  if (seeded.draft.kind === 'group') {
    return {
      draft: seeded.draft,
      identity: seeded.identity,
      negatedNodeIds: seeded.negatedNodeIds,
    };
  }
  return {
    draft: { kind: 'group', join: 'all', children: [seeded.draft] },
    identity: { id: allocateId(), children: [seeded.identity] },
    negatedNodeIds: seeded.negatedNodeIds,
  };
}

function identityForDraft<TTarget extends ViewTarget>(
  draft: WorkViewFilterDraftFor<TTarget>,
  allocateId: () => string,
): DraftIdentity {
  return {
    id: allocateId(),
    children:
      draft.kind === 'group'
        ? draft.children.map((child) => identityForDraft(child, allocateId))
        : [],
  };
}

function appendIdentity(
  identity: DraftIdentity,
  path: readonly number[],
  child: DraftIdentity,
): DraftIdentity {
  if (path.length === 0) return { ...identity, children: [...identity.children, child] };
  const [head, ...rest] = path;
  return {
    ...identity,
    children: identity.children.map((current, index) =>
      index === head ? appendIdentity(current, rest, child) : current,
    ),
  };
}

function removeIdentity(identity: DraftIdentity, path: readonly number[]): DraftIdentity {
  const [head, ...rest] = path;
  if (head === undefined) return identity;
  if (rest.length === 0) {
    return { ...identity, children: identity.children.filter((_, index) => index !== head) };
  }
  return {
    ...identity,
    children: identity.children.map((child, index) =>
      index === head ? removeIdentity(child, rest) : child,
    ),
  };
}

function identityAtPath(identity: DraftIdentity, path: readonly number[]): DraftIdentity | null {
  let current: DraftIdentity | undefined = identity;
  for (const index of path) current = current?.children[index];
  return current ?? null;
}

function collectIdentityIds(identity: DraftIdentity): ReadonlySet<string> {
  const ids = new Set<string>();
  const visit = (node: DraftIdentity): void => {
    ids.add(node.id);
    node.children.forEach((child) => {
      visit(child);
    });
  };
  visit(identity);
  return ids;
}

function negatedPathsForIdentity(
  identity: DraftIdentity,
  negatedIds: ReadonlySet<string>,
): readonly string[] {
  const paths: string[] = [];
  const visit = (node: DraftIdentity, path: readonly number[]): void => {
    if (negatedIds.has(node.id)) paths.push(pathKey(path));
    node.children.forEach((child, index) => {
      visit(child, [...path, index]);
    });
  };
  visit(identity, []);
  return paths;
}

interface DraftEditorProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly timezone: string;
  readonly draft: WorkViewFilterDraftFor<TTarget>;
  readonly identity: DraftIdentity;
  readonly path: readonly number[];
  readonly negatedNodeIds: ReadonlySet<string>;
  readonly facetResponse?: WorkViewFacetResponseForTarget<TTarget> | undefined;
  readonly facetLoading: boolean;
  readonly facetHasMore: boolean;
  readonly facetLoadingMore: boolean;
  readonly onFacetLoadMore?: (() => void) | undefined;
  readonly onFacetRequest?:
    ((field: WorkViewFilterFieldKey<TTarget>, search: string) => void) | undefined;
  readonly onReplace: (path: readonly number[], draft: WorkViewFilterDraftFor<TTarget>) => void;
  readonly onAppend: (path: readonly number[], draft: WorkViewFilterDraftFor<TTarget>) => void;
  readonly onNegate: (nodeId: string) => void;
  readonly onRemove?: ((path: readonly number[]) => void) | undefined;
}

function DraftEditor<TTarget extends ViewTarget>({
  target,
  timezone,
  draft,
  identity,
  path,
  negatedNodeIds,
  facetResponse,
  facetLoading,
  facetHasMore,
  facetLoadingMore,
  onFacetLoadMore,
  onFacetRequest,
  onReplace,
  onAppend,
  onNegate,
  onRemove,
}: DraftEditorProps<TTarget>): ReactElement {
  const [facetSearch, setFacetSearch] = useState('');
  const fields = useMemo(() => workViewFilterFieldCatalog(target), [target]);
  const selectedField =
    draft.kind === 'predicate'
      ? (fields.find((field) => String(field.key) === String(draft.field)) ?? null)
      : null;
  const choiceField =
    selectedField?.kind === 'enum' ||
    selectedField?.kind === 'relation-one' ||
    selectedField?.kind === 'relation-many';

  useEffect(() => {
    if (!choiceField || !onFacetRequest) return;
    onFacetRequest(selectedField.key, facetSearch);
  }, [choiceField, facetSearch, onFacetRequest, selectedField]);

  if (draft.kind === 'group') {
    const groupNumber = path.length + 1;
    const groupName =
      path.length === 0 ? 'root filter group' : `filter group ${String(groupNumber)}`;
    return (
      <Surface
        tone="well"
        shape="small"
        pad="tight"
        as="section"
        role="group"
        aria-label={`Filter group ${String(groupNumber)}`}
      >
        <Stack gap={2}>
          <Row justify="between">
            <Select
              aria-label="Filter group operator"
              value={draft.join}
              onChange={(event) => {
                onReplace(path, {
                  ...draft,
                  join: event.target.value === 'any' ? 'any' : 'all',
                });
              }}
            >
              <option value="all">All conditions</option>
              <option value="any">Any condition</option>
            </Select>
            <ControlGroup controlSize="xs">
              <Button
                variant="ghost"
                aria-pressed={negatedNodeIds.has(identity.id)}
                aria-label={`Negate ${groupName}`}
                onClick={() => {
                  onNegate(identity.id);
                }}
              >
                Not
              </Button>
              {onRemove && path.length > 0 ? (
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label={`Remove ${groupName}`}
                  onClick={() => {
                    onRemove(path);
                  }}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </ControlGroup>
          </Row>
          {draft.children.map((child, index) => {
            const childIdentity = identity.children[index];
            return childIdentity ? (
              <DraftEditor
                key={childIdentity.id}
                target={target}
                timezone={timezone}
                draft={child}
                identity={childIdentity}
                path={[...path, index]}
                negatedNodeIds={negatedNodeIds}
                facetResponse={facetResponse}
                facetLoading={facetLoading}
                facetHasMore={facetHasMore}
                facetLoadingMore={facetLoadingMore}
                onFacetLoadMore={onFacetLoadMore}
                onFacetRequest={onFacetRequest}
                onReplace={onReplace}
                onAppend={onAppend}
                onNegate={onNegate}
                onRemove={onRemove}
              />
            ) : null;
          })}
          <ControlGroup controlSize="xs">
            <Button
              variant="ghost"
              aria-label={`Add condition to ${groupName}`}
              onClick={() => {
                onAppend(path, emptyPredicate<TTarget>());
              }}
            >
              <Plus aria-hidden />
              Condition
            </Button>
            <Button
              variant="ghost"
              aria-label={`Add group to ${groupName}`}
              onClick={() => {
                onAppend(path, {
                  kind: 'group',
                  join: 'all',
                  children: [emptyPredicate<TTarget>()],
                });
              }}
            >
              <Plus aria-hidden />
              Group
            </Button>
          </ControlGroup>
        </Stack>
      </Surface>
    );
  }

  const operators = selectedField?.operators ?? [];
  const unary = draft.operator === 'isEmpty' || draft.operator === 'isNotEmpty';
  const multiple = draft.operator !== null && SET_OPERATORS.has(draft.operator);
  const between = draft.operator === 'between';
  const bucket = facetResponse?.buckets.find((candidate) =>
    sameKey(candidate.field, selectedField?.key),
  );
  const rangeValues: readonly unknown[] = Array.isArray(draft.operand)
    ? draft.operand.map((value: unknown) => value)
    : [];
  const conditionNumber = (path.at(-1) ?? 0) + 1;

  return (
    <Stack gap={1}>
      <ControlGroup controlSize="sm">
        <Select
          aria-label="Filter field"
          value={controlValue(draft.field)}
          onChange={(event) => {
            const field =
              fields.find((candidate) => sameKey(candidate.key, event.target.value)) ?? null;
            onReplace(path, {
              kind: 'predicate',
              field: field ? field.key : null,
              operator: firstValue(field?.operators ?? []),
              ...(field?.kind === 'boolean' ? { operand: true } : {}),
            });
            setFacetSearch('');
          }}
        >
          <option value="">Choose field</option>
          {fields.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter operator"
          value={draft.operator ?? ''}
          disabled={!selectedField}
          onChange={(event) => {
            const operator = event.target.value;
            onReplace(path, {
              ...draft,
              operator,
              ...(operator === 'isEmpty' || operator === 'isNotEmpty'
                ? {}
                : operator === 'between' || SET_OPERATORS.has(operator)
                  ? { operand: [] }
                  : selectedField?.kind === 'boolean'
                    ? { operand: true }
                    : { operand: undefined }),
            });
          }}
        >
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {operatorLabel(operator)}
            </option>
          ))}
        </Select>
        <Button
          variant="ghost"
          aria-pressed={negatedNodeIds.has(identity.id)}
          aria-label={`Negate condition ${String(conditionNumber)}`}
          onClick={() => {
            onNegate(identity.id);
          }}
        >
          Not
        </Button>
        {onRemove ? (
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Remove condition ${String(conditionNumber)}`}
            onClick={() => {
              onRemove(path);
            }}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </ControlGroup>

      {!unary && selectedField && choiceField ? (
        <Stack gap={1}>
          <Input
            variant="filled"
            type="search"
            role="searchbox"
            aria-label={`Search ${selectedField.label} options`}
            placeholder={`Search ${selectedField.label.toLowerCase()}`}
            value={facetSearch}
            onChange={(event) => {
              setFacetSearch(event.target.value);
            }}
          />
          {facetLoading ? (
            <Text token="body-small" tone="muted">
              Loading options…
            </Text>
          ) : null}
          {selectedField.acceptsCurrentActor ? (
            <label>
              <Checkbox
                aria-label="Me"
                checked={selectedOperand(draft.operand, { kind: 'current-actor' })}
                onChange={(event) => {
                  const value = { kind: 'current-actor' } as const;
                  const current = operandValues(draft.operand);
                  const next = event.target.checked
                    ? multiple
                      ? [...current, value]
                      : [value]
                    : current.filter(
                        (operand) => JSON.stringify(operand) !== JSON.stringify(value),
                      );
                  onReplace(path, {
                    ...draft,
                    operand: multiple ? next : next[0],
                  });
                }}
              />
              <Text as="span" token="label-medium">
                Me
              </Text>
            </label>
          ) : null}
          {bucket?.options.map((option, index) => {
            const checked = selectedOperand(draft.operand, option.value);
            const matchLabel = `${option.label}, ${String(option.count)} ${option.count === 1 ? 'match' : 'matches'}`;
            return (
              <label key={`${option.label}-${String(index)}`}>
                <Checkbox
                  aria-label={matchLabel}
                  checked={checked}
                  onChange={(event) => {
                    const current = operandValues(draft.operand);
                    const next = event.target.checked
                      ? multiple
                        ? [...current, option.value]
                        : [option.value]
                      : current.filter(
                          (value) => JSON.stringify(value) !== JSON.stringify(option.value),
                        );
                    onReplace(path, {
                      ...draft,
                      operand: multiple ? next : next[0],
                    });
                  }}
                />
                <Text as="span" token="label-medium">
                  {option.label}
                </Text>
                <Text as="span" token="body-small" tone="muted">
                  {option.count}
                </Text>
              </label>
            );
          })}
          {facetHasMore && onFacetLoadMore ? (
            <Button
              variant="ghost"
              aria-label={`Load more ${selectedField.label} options`}
              disabled={facetLoadingMore}
              onClick={onFacetLoadMore}
            >
              {facetLoadingMore ? 'Loading more…' : 'Load more options'}
            </Button>
          ) : null}
        </Stack>
      ) : null}

      {!unary && selectedField && between ? (
        selectedField.kind === 'date' || selectedField.kind === 'datetime' ? (
          <Stack gap={1}>
            <TemporalOperandEditor
              key={`minimum-${String(selectedField.key)}`}
              fieldKind={selectedField.kind}
              label={`Minimum ${selectedField.label}`}
              modeLabel={`Minimum ${selectedField.label} value type`}
              operand={rangeValues[0]}
              timezone={timezone}
              onChange={(operand) => {
                onReplace(path, { ...draft, operand: [operand, rangeValues[1]] });
              }}
            />
            <TemporalOperandEditor
              key={`maximum-${String(selectedField.key)}`}
              fieldKind={selectedField.kind}
              label={`Maximum ${selectedField.label}`}
              modeLabel={`Maximum ${selectedField.label} value type`}
              operand={rangeValues[1]}
              timezone={timezone}
              onChange={(operand) => {
                onReplace(path, { ...draft, operand: [rangeValues[0], operand] });
              }}
            />
          </Stack>
        ) : (
          <ControlGroup controlSize="sm">
            <Input
              variant="filled"
              aria-label={`Minimum ${selectedField.label}`}
              type="number"
              value={inputValue(rangeValues[0])}
              onChange={(event) => {
                onReplace(path, {
                  ...draft,
                  operand: [
                    inputOperand(selectedField.kind, event.target.value, timezone),
                    rangeValues[1],
                  ],
                });
              }}
            />
            <Input
              variant="filled"
              aria-label={`Maximum ${selectedField.label}`}
              type="number"
              value={inputValue(rangeValues[1])}
              onChange={(event) => {
                onReplace(path, {
                  ...draft,
                  operand: [
                    rangeValues[0],
                    inputOperand(selectedField.kind, event.target.value, timezone),
                  ],
                });
              }}
            />
          </ControlGroup>
        )
      ) : null}

      {!unary && selectedField && !choiceField && !between ? (
        selectedField.kind === 'boolean' ? (
          <Select
            aria-label="Filter value"
            value={draft.operand === false ? 'false' : 'true'}
            onChange={(event) => {
              onReplace(path, { ...draft, operand: event.target.value === 'true' });
            }}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </Select>
        ) : selectedField.kind === 'date' || selectedField.kind === 'datetime' ? (
          <TemporalOperandEditor
            key={String(selectedField.key)}
            fieldKind={selectedField.kind}
            label="Filter value"
            modeLabel="Date value type"
            operand={draft.operand}
            timezone={timezone}
            onChange={(operand) => {
              onReplace(path, { ...draft, operand });
            }}
          />
        ) : (
          <Input
            variant="filled"
            aria-label="Filter value"
            type={selectedField.kind === 'number' ? 'number' : 'text'}
            value={inputValue(draft.operand)}
            onChange={(event) => {
              onReplace(path, {
                ...draft,
                operand: inputOperand(selectedField.kind, event.target.value, timezone),
              });
            }}
          />
        )
      ) : null}
    </Stack>
  );
}

/** Build a searchable simple filter or a recursive all, any, and not formula from draft state. */
export function FilterBuilder<TTarget extends ViewTarget>({
  target,
  filter,
  timezone = LOCAL_TIMEZONE,
  open,
  onOpenChange,
  trigger,
  onApply,
  facetResponse,
  facetLoading = false,
  facetHasMore = false,
  facetLoadingMore = false,
  onFacetLoadMore,
  onFacetRequest,
}: FilterBuilderProps<TTarget>): ReactElement {
  const nextIdentity = useRef(0);
  function allocateIdentity(): string {
    const id = `filter-node-${String(nextIdentity.current)}`;
    nextIdentity.current += 1;
    return id;
  }
  const [internalOpen, setInternalOpen] = useState(false);
  const [advanced, setAdvanced] = useState(filter != null);
  const [query, setQuery] = useState('');
  const initialEditor = useRef(seedEditor(filter, allocateIdentity));
  const [negatedNodeIds, setNegatedNodeIds] = useState<ReadonlySet<string>>(
    initialEditor.current.negatedNodeIds,
  );
  const [editor, setEditor] = useState(() => ({
    draft: initialEditor.current.draft,
    identity: initialEditor.current.identity,
  }));
  const fieldButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const { draft, identity } = editor;
  const actualOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const fields = useMemo(
    () =>
      workViewFilterFieldCatalog(target).filter((field) =>
        field.label.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, target],
  );
  const parsed = parseFilterDraft(target, draft, negatedPathsForIdentity(identity, negatedNodeIds));

  function onReplace(path: readonly number[], replacement: WorkViewFilterDraftFor<TTarget>): void {
    setEditor((current) => {
      const next = replaceDraft(current.draft, path, replacement);
      return next.kind === 'group' ? { ...current, draft: next } : current;
    });
  }

  function onNegate(nodeId: string): void {
    setNegatedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  return (
    <Popover open={actualOpen} onOpenChange={setOpen}>
      {trigger ? <PopoverTrigger asChild>{trigger}</PopoverTrigger> : null}
      <PopoverContent align="end" role="dialog" aria-label={`Filter ${labelTarget(target)}`}>
        <Stack gap={1}>
          {!advanced ? (
            <Input
              variant="filled"
              controlSize="lg"
              type="search"
              role="searchbox"
              aria-label="Search filters"
              placeholder="Search properties"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                const index = event.key === 'ArrowDown' ? 0 : fields.length - 1;
                fieldButtons.current[index]?.focus();
              }}
            />
          ) : null}

          {!advanced ? (
            <Stack as="ul" aria-label="Filter properties" gap={0}>
              {fields.map((field, index) => (
                <li key={field.key}>
                  <button
                    type="button"
                    ref={(element) => {
                      fieldButtons.current[index] = element;
                    }}
                    className={workViewPopoverItem()}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                      event.preventDefault();
                      const direction = event.key === 'ArrowDown' ? 1 : -1;
                      const nextIndex = (index + direction + fields.length) % fields.length;
                      fieldButtons.current[nextIndex]?.focus();
                    }}
                    onClick={() => {
                      const nextDraft: DraftGroup<TTarget> = {
                        kind: 'group',
                        join: 'all',
                        children: [
                          {
                            kind: 'predicate',
                            field: field.key,
                            operator: field.operators[0] ?? null,
                            ...(field.kind === 'boolean' ? { operand: true } : {}),
                          },
                        ],
                      };
                      setEditor({
                        draft: nextDraft,
                        identity: identityForDraft(nextDraft, allocateIdentity),
                      });
                      setNegatedNodeIds(new Set());
                      setAdvanced(true);
                    }}
                  >
                    {field.label}
                  </button>
                </li>
              ))}
            </Stack>
          ) : (
            <DraftEditor
              target={target}
              timezone={timezone}
              draft={draft}
              identity={identity}
              path={[]}
              negatedNodeIds={negatedNodeIds}
              facetResponse={facetResponse}
              facetLoading={facetLoading}
              facetHasMore={facetHasMore}
              facetLoadingMore={facetLoadingMore}
              onFacetLoadMore={onFacetLoadMore}
              onFacetRequest={onFacetRequest}
              onReplace={onReplace}
              onAppend={(path, child) => {
                const childIdentity = identityForDraft(child, allocateIdentity);
                setEditor((current) => ({
                  draft: appendDraft(current.draft, path, child),
                  identity: appendIdentity(current.identity, path, childIdentity),
                }));
              }}
              onNegate={onNegate}
              onRemove={(path) => {
                const removedIdentity = identityAtPath(identity, path);
                const removedIds = removedIdentity
                  ? collectIdentityIds(removedIdentity)
                  : new Set<string>();
                setEditor((current) => ({
                  draft: removeDraft(current.draft, path),
                  identity: removeIdentity(current.identity, path),
                }));
                setNegatedNodeIds(
                  (current) => new Set([...current].filter((nodeId) => !removedIds.has(nodeId))),
                );
              }}
            />
          )}

          <div role="separator" className={workViewPopoverSeparator} />
          {!advanced ? (
            <button
              type="button"
              className={workViewPopoverItem()}
              onClick={() => {
                setAdvanced(true);
              }}
            >
              Advanced filter
            </button>
          ) : (
            <ControlGroup controlSize="lg" className="justify-between px-2 py-1">
              <Button
                variant="ghost"
                onClick={() => {
                  setAdvanced(false);
                }}
              >
                Back to properties
              </Button>
              <Button
                disabled={!parsed.success}
                onClick={() => {
                  if (!parsed.success) return;
                  onApply(parsed.data);
                  setOpen(false);
                }}
              >
                <Filter aria-hidden />
                Apply filter
              </Button>
            </ControlGroup>
          )}
        </Stack>
      </PopoverContent>
    </Popover>
  );
}
