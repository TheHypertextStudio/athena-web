'use client';

import { ChevronDown, ChevronUp, ListOrdered, Plus, X } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Row,
  Stack,
  Text,
} from '@docket/ui/primitives';
import type { ReactElement, ReactNode } from 'react';

import type { ViewTarget } from '@docket/work/view-contract';

import {
  appendSortTerm,
  moveSortTerm,
  type WorkViewSortTermFor,
  workViewSortFieldCatalog,
} from './view-state';

/** One shared ordered-sort editor term. */
export type WorkViewSortTerm<TTarget extends ViewTarget> = WorkViewSortTermFor<TTarget>;

/** Props for the shared ordered-sort editor. */
export interface SortBuilderProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly terms: readonly WorkViewSortTerm<TTarget>[];
  readonly onChange: (terms: readonly WorkViewSortTerm<TTarget>[]) => void;
  readonly trigger?: ReactNode;
}

/** Edit the complete ordered sort list without treating the first term as special. */
export function SortBuilder<TTarget extends ViewTarget>({
  target,
  terms,
  onChange,
  trigger,
}: SortBuilderProps<TTarget>): ReactElement {
  const fields = workViewSortFieldCatalog(target);
  const fieldLabel = new Map<string, string>(
    fields.map((field) => [String(field.key), field.label]),
  );

  const editor = (
    <Stack gap={2} aria-label={`Sort ${target}s`}>
      {terms.length === 0 ? (
        <Text token="body-small" tone="muted">
          The shared manual order is active.
        </Text>
      ) : (
        <Stack as="ol" gap={1} aria-label="Ordered sort terms">
          {terms.map((term, index) => {
            const label = fieldLabel.get(String(term.field)) ?? term.field;
            const previous = index > 0 ? terms[index - 1] : null;
            const next = terms[index + 1];
            return (
              <Row as="li" key={term.field} justify="between">
                <Text token="label-medium">{`${String(index + 1)}. ${label}`}</Text>
                <ControlGroup controlSize="xs">
                  {previous ? (
                    <Button
                      variant="ghost"
                      iconOnly
                      aria-label={`Move ${label} before ${fieldLabel.get(String(previous.field)) ?? previous.field}`}
                      onClick={() => {
                        onChange(moveSortTerm(terms, index, index - 1));
                      }}
                    >
                      <ChevronUp aria-hidden />
                    </Button>
                  ) : null}
                  {index < terms.length - 1 ? (
                    <Button
                      variant="ghost"
                      iconOnly
                      aria-label={`Move ${label} after ${next ? (fieldLabel.get(String(next.field)) ?? next.field) : ''}`}
                      onClick={() => {
                        onChange(moveSortTerm(terms, index, index + 1));
                      }}
                    >
                      <ChevronDown aria-hidden />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    aria-label={`Reverse ${label} sort`}
                    onClick={() => {
                      onChange(
                        terms.map((current, currentIndex) =>
                          currentIndex === index
                            ? {
                                ...current,
                                direction: current.direction === 'asc' ? 'desc' : 'asc',
                              }
                            : current,
                        ),
                      );
                    }}
                  >
                    {term.direction === 'asc' ? 'Ascending' : 'Descending'}
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    aria-label={`Remove ${label} sort`}
                    onClick={() => {
                      onChange(terms.filter((_, currentIndex) => currentIndex !== index));
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </ControlGroup>
              </Row>
            );
          })}
        </Stack>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">
            <Plus aria-hidden />
            Add sort
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Available sort fields">
          {fields
            .filter((field) => !terms.some((term) => term.field === field.key))
            .map((field) => (
              <DropdownMenuItem
                key={field.key}
                onSelect={() => {
                  onChange(appendSortTerm(terms, { field: field.key, direction: 'asc' }));
                }}
              >
                {field.label}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Stack>
  );

  if (!trigger) return editor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label="Sort view" width="xl">
        {editor}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Default compact trigger for an ordered-sort builder. */
export function SortBuilderTrigger(): ReactElement {
  return (
    <Button variant="ghost" aria-label="Sort">
      <ListOrdered aria-hidden />
      Sort
    </Button>
  );
}
