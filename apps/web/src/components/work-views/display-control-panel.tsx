'use client';

import { ChevronLeft, LayoutGrid, ListView, Search } from '@docket/ui/icons';
import { Button, Checkbox, Select, Stack, Text } from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import type { ReactElement } from 'react';

import {
  parseWorkViewDefinition,
  toggleDisplayedProperty,
  type WorkViewDefinitionFor,
  type WorkViewDisplayFieldKey,
  workViewDisplayFieldCatalog,
  workViewGroupFieldCatalog,
} from './view-state';
import { workViewRendererLayouts } from './work-view-renderers';
import { SortBuilder } from './sort-builder';

/** The currently visible command surface inside the Display popover. */
export type DisplayPanel = 'root' | 'organize' | 'properties';

/** Props for the bounded Display command surface. */
export interface DisplayControlPanelProps<TTarget extends ViewTarget> {
  readonly panel: DisplayPanel;
  readonly target: TTarget;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly onPanelChange: (panel: DisplayPanel) => void;
  readonly onChange: (definition: WorkViewDefinitionFor<TTarget>) => void;
  /** Open the temporary roster finder from the root command surface. */
  readonly onFind?: (() => void) | undefined;
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

/** Render the Display root or one of its focused subpanels without opening another overlay. */
export function DisplayControlPanel<TTarget extends ViewTarget>({
  panel,
  target,
  definition,
  onPanelChange,
  onChange,
  onFind,
}: DisplayControlPanelProps<TTarget>): ReactElement {
  const groupable = workViewGroupFieldCatalog(target);
  const displayable = workViewDisplayFieldCatalog(target);
  const layouts = workViewRendererLayouts(target);

  function commit(next: WorkViewDefinitionFor<TTarget>): void {
    onChange(parseWorkViewDefinition(target, next));
  }

  if (panel === 'root') {
    return (
      <Stack gap={3}>
        {onFind ? (
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={onFind}>
            <Search aria-hidden />
            Find in this view
          </Button>
        ) : null}
        <Stack gap={1}>
          <Text as="h3" token="label-medium">
            Layout
          </Text>
          <Stack role="radiogroup" gap={0}>
            {layouts.map((layout) => {
              const selected = definition.presentation.layout === layout;
              return (
                <Button
                  type="button"
                  key={layout}
                  role="radio"
                  aria-checked={selected}
                  variant={selected ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
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
                </Button>
              );
            })}
          </Stack>
        </Stack>
        <Stack gap={1}>
          <Text as="h3" token="label-medium">
            View options
          </Text>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-between"
            onClick={() => {
              onPanelChange('organize');
            }}
          >
            Organize
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-between"
            onClick={() => {
              onPanelChange('properties');
            }}
          >
            Properties
          </Button>
        </Stack>
      </Stack>
    );
  }

  if (panel === 'organize') {
    return (
      <Stack gap={3}>
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => {
            onPanelChange('root');
          }}
        >
          <ChevronLeft aria-hidden />
          Back
        </Button>
        <Text as="h3" token="title-small">
          Organize
        </Text>
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
                arrangement: { ...definition.arrangement, subGroupBy },
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
      </Stack>
    );
  }

  return (
    <Stack gap={3}>
      <Button
        type="button"
        variant="ghost"
        className="w-fit"
        onClick={() => {
          onPanelChange('root');
        }}
      >
        <ChevronLeft aria-hidden />
        Back
      </Button>
      <Text as="h3" token="title-small">
        Properties
      </Text>
      <Stack role="group" aria-label="Displayed properties" gap={0}>
        {displayable.map((field) => {
          const checked = definition.presentation.properties.some(
            (property) => String(property) === String(field.key),
          );
          return (
            <label key={field.key} className="flex min-h-11 items-center gap-3 px-1 py-2">
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
    </Stack>
  );
}
