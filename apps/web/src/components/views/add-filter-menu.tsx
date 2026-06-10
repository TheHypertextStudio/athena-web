'use client';

import { Plus } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import type { FieldCatalog, FieldDescriptor, FilterOperator } from './field-catalog';
import { OPERATOR_LABEL, operatorsForType, optionsFor } from './field-catalog';

interface AddFilterMenuProps<T> {
  fields: FieldCatalog<T>;
  onAdd: (field: string, op: FilterOperator, value: unknown) => void;
}

export function AddFilterMenu<T>({ fields, onAdd }: AddFilterMenuProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" aria-hidden="true" />
          Add filter
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>Filter where</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {fields.map((field) => (
          <DropdownMenuSub key={field.key}>
            <DropdownMenuSubTrigger>{field.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[14rem]">
              {operatorsForType(field.type).map((op) => (
                <OperatorBranch
                  key={op}
                  field={field}
                  op={op}
                  onCommit={(value) => {
                    onAdd(field.key, op, value);
                    setOpen(false);
                  }}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface OperatorBranchProps<T> {
  field: FieldDescriptor<T>;
  op: FilterOperator;
  onCommit: (value: unknown) => void;
}

function OperatorBranch<T>({ field, op, onCommit }: OperatorBranchProps<T>): JSX.Element {
  const opLabel = OPERATOR_LABEL[op];
  const hasOptions = field.type === 'enum' || field.type === 'relation';

  if (hasOptions) {
    const options = optionsFor(field);
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{opLabel}…</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[12rem]">
          {options.length === 0 ? (
            <DropdownMenuItem disabled>No options</DropdownMenuItem>
          ) : (
            options.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => {
                  onCommit(op === 'in' || op === 'nin' ? [option.value] : option.value);
                }}
              >
                {option.label}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{opLabel}…</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[14rem] p-2">
        <ValueEntry
          placeholder={`${opLabel}…`}
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          onCommit={onCommit}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

interface ValueEntryProps {
  placeholder: string;
  type: 'text' | 'date' | 'number';
  onCommit: (value: string) => void;
}

function ValueEntry({ placeholder, type, onCommit }: ValueEntryProps): JSX.Element {
  const [value, setValue] = useState('');
  return (
    <Input
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      autoFocus
      className="h-8"
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter' && value.trim().length > 0) {
          event.preventDefault();
          onCommit(value.trim());
        }
      }}
    />
  );
}
