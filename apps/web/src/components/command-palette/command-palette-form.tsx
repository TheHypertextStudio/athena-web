/**
 * Command palette inline form component.
 *
 * When an action has a form definition, this component renders the form
 * inline within the command palette. Users can fill out fields and submit
 * without leaving the palette.
 *
 * ## Form Flow
 *
 * ```
 * User selects action with form
 *          │
 *          ▼
 * Palette switches to form mode
 * (activeAction is set)
 *          │
 *          ▼
 * Form fields rendered from action.form
 * (defaults populated from context)
 *          │
 *          ▼
 * User fills out fields
 * (formData updated via setFormField)
 *          │
 *          ▼
 * User presses Enter or clicks Submit
 *          │
 *          ▼
 * Validation runs (Zod schemas)
 *          │
 *          ├── Invalid ──► Show errors, stay in form
 *          │
 *          ▼
 * action.execute() called with formData
 *          │
 *          ▼
 * Palette closes on success
 * ```
 *
 * ## Field Types
 *
 * The form system supports these field types:
 * - `text` - Single line text input
 * - `textarea` - Multi-line text input
 * - `select` - Dropdown selection
 * - `combobox` - Searchable dropdown (not yet implemented)
 * - `checkbox` - Boolean toggle
 * - `date` - Date picker (not yet implemented)
 *
 * @packageDocumentation
 */

'use client';

import { useCallback, useMemo, useEffect, useRef } from 'react';
import { z } from 'zod';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActionForm, CommandContext, FormField, SelectOption } from '@/lib/command-palette';
import { useCommandPalette } from './command-palette-provider';

/**
 * Command palette form component.
 *
 * Renders the inline form for the currently active action.
 * Must be used within CommandPaletteProvider when activeAction is set.
 *
 * @example
 * // Used internally by CommandPalette when in form mode
 * {activeAction ? <CommandPaletteForm /> : <ActionList />}
 */
export function CommandPaletteForm() {
  const {
    activeAction,
    context,
    formData,
    setFormField,
    formErrors,
    executeAction,
    isExecuting,
    setActiveAction,
    clearFormData,
  } = useCommandPalette();

  const formRef = useRef<HTMLFormElement>(null);

  // Get form definition from action
  const form = useMemo<ActionForm | null>(() => {
    if (!activeAction?.form) return null;

    return typeof activeAction.form === 'function' ? activeAction.form(context) : activeAction.form;
  }, [activeAction, context]);

  const resolveDefaultValue = useCallback(
    (defaultValue: FormField['defaultValue']): unknown => {
      const isFactory = (
        value: FormField['defaultValue'],
      ): value is (ctx: CommandContext) => unknown => typeof value === 'function';

      if (isFactory(defaultValue)) {
        return defaultValue(context);
      }
      return defaultValue;
    },
    [context],
  );

  // Initialize form data with defaults on mount
  useEffect(() => {
    if (!form) return;

    const initialData: Record<string, unknown> = {};

    for (const field of form.fields) {
      if (field.defaultValue !== undefined) {
        initialData[field.name] = resolveDefaultValue(field.defaultValue);
      }
    }

    // Set all initial values
    for (const [name, value] of Object.entries(initialData)) {
      setFormField(name, value);
    }
  }, [form, resolveDefaultValue, setFormField]);

  // Focus first field on mount
  useEffect(() => {
    if (form?.autoFocus !== false) {
      requestAnimationFrame(() => {
        const firstInput = formRef.current?.querySelector<HTMLElement>(
          'input:not([type="hidden"]), textarea, select',
        );
        firstInput?.focus();
      });
    }
  }, [form]);

  /**
   * Handle form submission.
   * Validates all fields and executes the action if valid.
   */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!activeAction || !form) return;

      // Validate all fields
      const errors: Record<string, string> = {};
      const validatedData: Record<string, unknown> = {};

      for (const field of form.fields) {
        // Check if field should be visible
        if (field.when && !field.when(formData)) {
          continue;
        }

        const value = formData[field.name];

        try {
          validatedData[field.name] = field.schema.parse(value);
        } catch (error) {
          if (error instanceof z.ZodError) {
            errors[field.name] = error.issues[0]?.message ?? 'Invalid value';
          }
        }
      }

      // If there are errors, don't submit
      if (Object.keys(errors).length > 0) {
        for (const [name, message] of Object.entries(errors)) {
          // This would need formErrors setter exposed
          console.error(`[Form] Validation error for ${name}:`, message);
        }
        return;
      }

      // Execute the action
      await executeAction(activeAction);
    },
    [activeAction, form, formData, executeAction],
  );

  /**
   * Handle cancel (escape key is handled by provider).
   */
  const handleCancel = useCallback(() => {
    setActiveAction(null);
    clearFormData();
  }, [setActiveAction, clearFormData]);

  if (!form || !activeAction) {
    return null;
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="p-4"
      autoComplete="off"
    >
      {/* Form header with action info */}
      <div className="mb-4 flex items-center gap-2">
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            'bg-neutral-100 text-neutral-500',
            'dark:bg-neutral-800 dark:text-neutral-400',
          )}
        >
          <activeAction.icon className="h-4 w-4" />
        </div>
        <span className="font-medium text-neutral-900 dark:text-neutral-100">
          {activeAction.label}
        </span>
      </div>

      {/* Form fields */}
      <div
        className={cn('space-y-4', form.layout === 'grid' && 'grid grid-cols-2 gap-4 space-y-0')}
      >
        {form.fields.map((field) => (
          <FormFieldRenderer
            key={field.name}
            field={field}
            value={formData[field.name]}
            onChange={(value) => {
              setFormField(field.name, value);
            }}
            error={formErrors[field.name]}
            formData={formData}
          />
        ))}
      </div>

      {/* Submit button */}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm',
            'text-neutral-600 hover:bg-neutral-100',
            'dark:text-neutral-400 dark:hover:bg-neutral-800',
          )}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isExecuting}
          className={cn(
            'rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white',
            'hover:bg-neutral-800',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
          )}
        >
          {isExecuting ? 'Executing...' : (form.submitLabel ?? 'Submit')}
        </button>
      </div>
    </form>
  );
}

/**
 * Props for FormFieldRenderer.
 */
interface FormFieldRendererProps {
  /**
   * Field definition from the action form.
   */
  field: FormField;

  /**
   * Current field value.
   */
  value: unknown;

  /**
   * Callback when field value changes.
   */
  onChange: (value: unknown) => void;

  /**
   * Validation error message, if any.
   */
  error?: string;

  /**
   * All form data (for conditional fields).
   */
  formData: Record<string, unknown>;
}

/**
 * Renders a single form field based on its type.
 *
 * Handles different field types and their specific UI requirements.
 * Also handles conditional visibility via the `when` property.
 */
function FormFieldRenderer({ field, value, onChange, error, formData }: FormFieldRendererProps) {
  // Check conditional visibility
  if (field.when && !field.when(formData)) {
    return null;
  }

  const id = `field-${field.name}`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {field.required && <span className="ml-1 text-red-500">*</span>}
      </Label>

      {/* Render appropriate input based on type */}
      {renderFieldInput(field, id, value, onChange)}

      {/* Description */}
      {field.description && <p className="text-xs text-neutral-500">{field.description}</p>}

      {/* Error message */}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

/**
 * Render the input element for a field type.
 */
const toInputString = (input: unknown): string => (typeof input === 'string' ? input : '');
const toInputNumber = (input: unknown): number | '' =>
  typeof input === 'number' && !Number.isNaN(input) ? input : '';
const toInputBoolean = (input: unknown): boolean => (typeof input === 'boolean' ? input : false);
const toSelectValue = (input: unknown): string | undefined =>
  typeof input === 'string' ? input : undefined;

function renderFieldInput(
  field: FormField,
  id: string,
  value: unknown,
  onChange: (value: unknown) => void,
): React.ReactNode {
  switch (field.type) {
    case 'text':
      return (
        <Input
          id={id}
          type="text"
          value={toInputString(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={field.placeholder}
          className="h-9"
        />
      );

    case 'textarea':
      return (
        <textarea
          id={id}
          value={toInputString(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={field.placeholder}
          rows={3}
          className={cn(
            'w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2',
            'text-sm placeholder:text-neutral-400',
            'focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 focus:outline-none',
            'dark:border-neutral-800 dark:focus:ring-neutral-600',
          )}
        />
      );

    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={toInputNumber(value)}
          onChange={(e) => {
            onChange(e.target.valueAsNumber);
          }}
          placeholder={field.placeholder}
          className="h-9"
        />
      );

    case 'select':
      return (
        <SelectField
          id={id}
          value={toSelectValue(value)}
          onChange={onChange}
          options={field.options as SelectOption[] | undefined}
          placeholder={field.placeholder}
        />
      );

    case 'checkbox':
    case 'toggle':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={toInputBoolean(value)}
            onCheckedChange={(checked) => {
              onChange(checked);
            }}
          />
          {field.description && (
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              {field.description}
            </span>
          )}
        </div>
      );

    case 'date':
      return (
        <Input
          id={id}
          type="date"
          value={toInputString(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className="h-9"
        />
      );

    case 'time':
      return (
        <Input
          id={id}
          type="time"
          value={toInputString(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className="h-9"
        />
      );

    case 'datetime':
      return (
        <Input
          id={id}
          type="datetime-local"
          value={toInputString(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className="h-9"
        />
      );

    default:
      return (
        <Input
          id={id}
          type="text"
          value={toInputString(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={field.placeholder}
          className="h-9"
        />
      );
  }
}

/**
 * Props for SelectField.
 */
interface SelectFieldProps {
  id: string;
  value: string | undefined;
  onChange: (value: unknown) => void;
  options?: SelectOption[];
  placeholder?: string;
}

/**
 * Select field with static options.
 *
 * Note: Dynamic options (from async function) not yet implemented.
 */
function SelectField({ id, value, onChange, options, placeholder }: SelectFieldProps) {
  if (!options || options.length === 0) {
    return (
      <Input
        id={id}
        type="text"
        value={value ?? ''}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder ?? 'No options available'}
        className="h-9"
        disabled
      />
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-9">
        <SelectValue placeholder={placeholder ?? 'Select...'} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex items-center gap-2">
              {option.icon && <option.icon className="h-4 w-4" />}
              <span>{option.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
