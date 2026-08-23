'use client';

import { LayoutGrid, ListView, Search, TuneRounded } from '@docket/ui/icons';
import {
  Button,
  type ButtonProps,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Stack,
  Text,
} from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import type { ReactElement, ReactNode } from 'react';

import {
  parseWorkViewDefinition,
  toggleDisplayedProperty,
  type WorkViewDefinitionFor,
  type WorkViewDisplayFieldKey,
  workViewDisplayFieldCatalog,
  workViewGroupFieldCatalog,
} from './view-state';
import { workViewRendererLayouts } from './work-view-renderers';
import {
  workViewPopoverItem,
  workViewPopoverLabel,
  workViewPopoverSeparator,
} from './work-view-popover-styles';
import { SortBuilder } from './sort-builder';

/** The arrangement or presentation section shown by one compact toolbar trigger. */
export type DisplayControlKind = 'group' | 'display' | 'layout' | 'properties';

/** Props for grouping, layout, and displayed-property controls. */
export interface DisplayControlsProps<TTarget extends ViewTarget> {
  readonly kind: DisplayControlKind;
  readonly target: TTarget;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly onChange: (definition: WorkViewDefinitionFor<TTarget>) => void;
  /** Open the temporary roster finder from the display menu. */
  readonly onFind?: (() => void) | undefined;
  readonly trigger: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** Props for display controls rendered inside an existing dialog or popover surface. */
export type DisplayControlsContentProps<TTarget extends ViewTarget> = Omit<
  DisplayControlsProps<TTarget>,
  'trigger' | 'open' | 'onOpenChange'
>;

function titleFor(kind: DisplayControlKind): string {
  if (kind === 'group') return 'Group';
  if (kind === 'display') return 'Display';
  if (kind === 'layout') return 'Layout';
  return 'Properties';
}

function controlValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sameKey(left: unknown, right: unknown): boolean {
  return left === right;
}

function selectedFieldKey<T extends string>(
  fields: readonly { readonly key: T }[],
  value: string,
): T | null {
  return fields.find((field) => field.key === value)?.key ?? null;
}

/** Render target-derived display controls without creating another overlay. */
export function DisplayControlsContent<TTarget extends ViewTarget>({
  kind,
  target,
  definition,
  onChange,
  onFind,
}: DisplayControlsContentProps<TTarget>): ReactElement {
  const groupable = workViewGroupFieldCatalog(target);
  const displayable = workViewDisplayFieldCatalog(target);
  const layouts = workViewRendererLayouts(target);

  function commit(next: WorkViewDefinitionFor<TTarget>): void {
    onChange(parseWorkViewDefinition(target, next));
  }

  const grouping = (
    <Stack gap={3}>
      <Stack as="label" gap={1}>
        <Text as="span" token="label-medium">
          Group by
        </Text>
        <Select
          controlSize="lg"
          value={controlValue(definition.arrangement.groupBy)}
          onChange={(event) => {
            const groupBy = selectedFieldKey(groupable, event.target.value);
            commit({
              ...definition,
              arrangement: {
                ...definition.arrangement,
                groupBy,
                subGroupBy: sameKey(definition.arrangement.subGroupBy, groupBy)
                  ? null
                  : definition.arrangement.subGroupBy,
              },
            });
          }}
        >
          <option value="">No grouping</option>
          {groupable.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label}
            </option>
          ))}
        </Select>
      </Stack>
      <Stack as="label" gap={1}>
        <Text as="span" token="label-medium">
          Subgroup by
        </Text>
        <Select
          controlSize="lg"
          value={controlValue(definition.arrangement.subGroupBy)}
          disabled={controlValue(definition.arrangement.groupBy) === ''}
          onChange={(event) => {
            const subGroupBy = selectedFieldKey(groupable, event.target.value);
            commit({
              ...definition,
              arrangement: {
                ...definition.arrangement,
                subGroupBy,
              },
            });
          }}
        >
          <option value="">No subgroup</option>
          {groupable
            .filter((field) => String(field.key) !== String(definition.arrangement.groupBy))
            .map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
        </Select>
      </Stack>
    </Stack>
  );

  const sorting = (
    <Stack gap={1}>
      <Text as="h4" token="label-medium">
        Sort
      </Text>
      <SortBuilder
        target={target}
        terms={definition.arrangement.orderBy}
        onChange={(orderBy) => {
          commit({
            ...definition,
            arrangement: { ...definition.arrangement, orderBy },
          });
        }}
      />
    </Stack>
  );

  const layoutControls = (
    <Stack role="radiogroup">
      {layouts.map((layout) => {
        const selected = definition.presentation.layout === layout;
        return (
          <button
            type="button"
            key={layout}
            role="radio"
            aria-checked={selected}
            className={workViewPopoverItem(selected)}
            onClick={() => {
              commit({
                ...definition,
                presentation: { ...definition.presentation, layout },
              });
            }}
          >
            {layout === 'list' ? <ListView aria-hidden /> : <LayoutGrid aria-hidden />}
            {layout[0]?.toUpperCase()}
            {layout.slice(1)}
          </button>
        );
      })}
    </Stack>
  );

  const propertyControls = (
    <Stack role="group" aria-label="Displayed properties">
      {displayable.map((field) => {
        const checked = definition.presentation.properties.some(
          (property) => String(property) === String(field.key),
        );
        return (
          <label key={field.key} className={workViewPopoverItem()}>
            <Checkbox
              checked={checked}
              onChange={(event) => {
                commit({
                  ...definition,
                  presentation: {
                    ...definition.presentation,
                    properties: toggleDisplayedProperty<WorkViewDisplayFieldKey<TTarget>>(
                      definition.presentation.properties,
                      field.key,
                      event.target.checked,
                    ),
                  },
                });
              }}
            />
            <Text as="span" token="label-medium">
              {field.label}
            </Text>
          </label>
        );
      })}
    </Stack>
  );

  if (kind === 'group') return grouping;
  if (kind === 'layout') return layoutControls;
  if (kind === 'properties') return propertyControls;

  return (
    <>
      {onFind ? (
        <button type="button" className={workViewPopoverItem()} onClick={onFind}>
          <Search aria-hidden /> Find in this view
        </button>
      ) : null}
      {onFind ? <div role="separator" className={workViewPopoverSeparator} /> : null}
      <Text as="h3" token="label-medium" className={workViewPopoverLabel}>
        Layout
      </Text>
      {layoutControls}
      <div role="separator" className={workViewPopoverSeparator} />
      <Text as="h3" token="label-medium" className={workViewPopoverLabel}>
        Organize
      </Text>
      <Stack gap={3} className="px-3 pb-2">
        {grouping}
        {sorting}
      </Stack>
      <div role="separator" className={workViewPopoverSeparator} />
      <Text as="h3" token="label-medium" className={workViewPopoverLabel}>
        Properties
      </Text>
      {propertyControls}
    </>
  );
}

/** Edit grouping, layout, or displayed properties from one anchored toolbar trigger. */
export function DisplayControls<TTarget extends ViewTarget>({
  kind,
  target,
  definition,
  onChange,
  onFind,
  trigger,
  open,
  onOpenChange,
}: DisplayControlsProps<TTarget>): ReactElement {
  return (
    <Popover {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={`${titleFor(kind)} view`}
        align="end"
        className={kind === 'display' ? 'overflow-y-auto' : undefined}
      >
        <DisplayControlsContent
          kind={kind}
          target={target}
          definition={definition}
          onChange={onChange}
          onFind={onFind}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Compact MD3 trigger for one display-control section. */
export function DisplayControlsTrigger({
  kind,
  iconOnly,
  ...props
}: {
  readonly kind: DisplayControlKind;
} & Omit<ButtonProps, 'children'>): ReactElement {
  const label = titleFor(kind);
  return (
    <Button variant="ghost" iconOnly={iconOnly} aria-label={label} {...props}>
      <TuneRounded aria-hidden />
      {iconOnly ? null : label}
    </Button>
  );
}
