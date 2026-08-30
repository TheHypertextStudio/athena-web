'use client';

/**
 * The schema-driven elicitation renderer: one control per declared kind, no bespoke forms.
 *
 * @remarks
 * There is exactly one renderer, and it is total over {@link ElicitationControl}. That is what
 * makes "anything expressible in Zod can be asked" true at the surface as well as in the contract:
 * a new schema shape reaches this file as a compile error in the switch, never as a card that
 * renders blank. The renderer draws controls from the *same* spec the server validates against, so
 * "what the form allowed" and "what the server accepted" cannot drift.
 *
 * Every control is uncontrolled-by-default in the DOM sense but fully controlled here: the value
 * lives in one state tree on the card, so a server rejection can re-render the form with the
 * person's other fields intact — which is the whole point of returning field-level errors.
 */
import type { ElicitationControl, ElicitationFileAnswer } from '@docket/athena/elicitation';
import { Check, Paperclip, Plus, X } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Chip,
  ControlGroup,
  Field,
  Input,
  surfaceToneColor,
  Text,
  Textarea,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useId, useRef, useState } from 'react';

import { api } from '@/lib/api';

/** Errors keyed by the dotted path the server reported them against. */
export type ElicitationErrorMap = Readonly<Record<string, string>>;

/** Props shared by every control renderer. */
export interface ElicitationControlProps {
  /** The declared control to render. */
  readonly control: ElicitationControl;
  /** The current value for this control. */
  readonly value: unknown;
  /** Report a new value for this control. */
  readonly onChange: (value: unknown) => void;
  /** Dotted path of this control inside the whole answer; `''` at the root. */
  readonly path: string;
  /** Server-reported errors for the whole answer, keyed by path. */
  readonly errors: ElicitationErrorMap;
  /** Disable every input while a submission is in flight. */
  readonly disabled?: boolean;
  /** The task uploads are attached to, so a file answer is durable and retrievable. */
  readonly uploadTarget?: { readonly orgId: string; readonly taskId: string };
}

/** The default (empty) value for one control, so a form starts in a coherent state. */
export function emptyElicitationValue(control: ElicitationControl): unknown {
  switch (control.kind) {
    case 'text':
      return '';
    case 'number':
      return '';
    case 'confirm':
      return null;
    case 'select':
      return control.multiple ? [] : null;
    case 'datetime':
      return '';
    case 'file':
      return control.multiple ? [] : null;
    case 'list':
      return [];
    case 'form': {
      const record: Record<string, unknown> = {};
      for (const field of control.fields) record[field.key] = emptyElicitationValue(field.control);
      return record;
    }
    case 'variant': {
      const first = control.variants[0];
      /* v8 ignore next -- @preserve declaration validation guarantees at least one arm */
      if (!first) return {};
      const record: Record<string, unknown> = { [control.discriminator]: first.value };
      for (const field of first.fields) record[field.key] = emptyElicitationValue(field.control);
      return record;
    }
  }
}

/**
 * Coerce the DOM's strings back to the types the spec declared.
 *
 * @remarks
 * `<input type="number">` yields a string and an empty field yields `''`; submitting either as-is
 * would be rejected by the server for the wrong reason ("wrong kind of value" rather than
 * "required"). Converting here means the person sees the error that matches what they did.
 */
export function coerceElicitationValue(control: ElicitationControl, value: unknown): unknown {
  if (control.kind === 'number') {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (control.kind === 'form') {
    const record = (value ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const field of control.fields) {
      const coerced = coerceElicitationValue(field.control, record[field.key]);
      if (!field.required && isBlank(coerced)) continue;
      next[field.key] = coerced;
    }
    return next;
  }
  if (control.kind === 'list') {
    const items = Array.isArray(value) ? value : [];
    return items.map((item) => coerceElicitationValue(control.item, item));
  }
  if (control.kind === 'variant') {
    const record = (value ?? {}) as Record<string, unknown>;
    const tag = discriminatorOf(record, control.discriminator);
    const variant = control.variants.find((candidate) => candidate.value === tag);
    if (!variant) return record;
    const next: Record<string, unknown> = { [control.discriminator]: tag };
    for (const field of variant.fields) {
      const coerced = coerceElicitationValue(field.control, record[field.key]);
      if (!field.required && isBlank(coerced)) continue;
      next[field.key] = coerced;
    }
    return next;
  }
  return value;
}

function isBlank(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
}

/** The chosen variant arm's tag, or `''` when the value carries none. */
function discriminatorOf(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/** Whether this control currently holds something worth submitting. */
export function isElicitationAnswered(control: ElicitationControl, value: unknown): boolean {
  if (control.kind === 'confirm') return typeof value === 'boolean';
  if (control.kind === 'select') {
    return control.multiple ? Array.isArray(value) && value.length > 0 : typeof value === 'string';
  }
  if (control.kind === 'file') {
    return control.multiple ? Array.isArray(value) && value.length > 0 : value !== null;
  }
  if (control.kind === 'number') return value !== '' && value !== null && value !== undefined;
  if (control.kind === 'form') {
    const record = (value ?? {}) as Record<string, unknown>;
    return control.fields.every(
      (field) => !field.required || isElicitationAnswered(field.control, record[field.key]),
    );
  }
  if (control.kind === 'variant') {
    const record = (value ?? {}) as Record<string, unknown>;
    const tag = discriminatorOf(record, control.discriminator);
    const variant = control.variants.find((candidate) => candidate.value === tag);
    if (!variant) return false;
    return variant.fields.every(
      (field) => !field.required || isElicitationAnswered(field.control, record[field.key]),
    );
  }
  if (control.kind === 'list') return Array.isArray(value);
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Render one declared control.
 *
 * @remarks
 * The switch is exhaustive over `ElicitationControl['kind']`, so adding a kind to the grammar
 * without adding a control here fails `tsc` rather than shipping an empty card.
 *
 * @param props - See {@link ElicitationControlProps}.
 */
export function ElicitationControlView(props: ElicitationControlProps): JSX.Element {
  const { control } = props;
  switch (control.kind) {
    case 'text':
      return <TextControl {...props} control={control} />;
    case 'number':
      return <NumberControl {...props} control={control} />;
    case 'confirm':
      return <ConfirmControl {...props} control={control} />;
    case 'select':
      return <SelectControl {...props} control={control} />;
    case 'datetime':
      return <DateTimeControl {...props} control={control} />;
    case 'file':
      return <FileControl {...props} control={control} />;
    case 'form':
      return <FormControl {...props} control={control} />;
    case 'list':
      return <ListControl {...props} control={control} />;
    case 'variant':
      return <VariantControl {...props} control={control} />;
  }
}

type Narrowed<K extends ElicitationControl['kind']> = ElicitationControlProps & {
  readonly control: Extract<ElicitationControl, { kind: K }>;
};

/** The error sentence for one path, when the server reported one. */
function errorAt(errors: ElicitationErrorMap, path: string): string | undefined {
  return errors[path];
}

function TextControl({
  control,
  value,
  onChange,
  path,
  errors,
  disabled,
}: Narrowed<'text'>): JSX.Element {
  const error = errorAt(errors, path);
  const shared = {
    value: typeof value === 'string' ? value : '',
    disabled,
    'aria-invalid': error ? true : undefined,
    placeholder: control.placeholder ?? undefined,
    onChange: (event: { target: { value: string } }) => {
      onChange(event.target.value);
    },
  };
  return control.multiline ? (
    <Textarea {...shared} rows={4} aria-label="Your answer" />
  ) : (
    <Input {...shared} aria-label="Your answer" />
  );
}

function NumberControl({
  control,
  value,
  onChange,
  path,
  errors,
  disabled,
}: Narrowed<'number'>): JSX.Element {
  const error = errorAt(errors, path);
  return (
    <Input
      type="number"
      inputMode={control.integer ? 'numeric' : 'decimal'}
      step={control.integer ? 1 : 'any'}
      {...(control.min !== null ? { min: control.min } : {})}
      {...(control.max !== null ? { max: control.max } : {})}
      value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
      disabled={disabled}
      aria-label="Your answer"
      aria-invalid={error ? true : undefined}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}

function ConfirmControl({ control, value, onChange, disabled }: Narrowed<'confirm'>): JSX.Element {
  return (
    <ControlGroup controlSize="lg" wrap>
      <Button
        type="button"
        variant={value === true ? 'default' : 'outline'}
        disabled={disabled}
        aria-pressed={value === true}
        onClick={() => {
          onChange(true);
        }}
      >
        {control.confirmLabel}
      </Button>
      <Button
        type="button"
        variant={value === false ? 'secondary' : 'outline'}
        disabled={disabled}
        aria-pressed={value === false}
        onClick={() => {
          onChange(false);
        }}
      >
        {control.declineLabel}
      </Button>
    </ControlGroup>
  );
}

function SelectControl({ control, value, onChange, disabled }: Narrowed<'select'>): JSX.Element {
  const selected = control.multiple
    ? new Set(
        Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === 'string')
          : [],
      )
    : new Set(typeof value === 'string' ? [value] : []);
  return (
    <ControlGroup controlSize="lg" wrap role="group" aria-label="Options">
      {control.options.map((option) => {
        const isSelected = selected.has(option.value);
        return (
          <Chip
            key={option.value}
            variant="filter"
            tone="outlined"
            icon={isSelected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
            selected={isSelected}
            disabled={disabled}
            title={option.description ?? undefined}
            onClick={() => {
              if (!control.multiple) {
                onChange(option.value);
                return;
              }
              const next = new Set(selected);
              if (next.has(option.value)) next.delete(option.value);
              else next.add(option.value);
              onChange([...next]);
            }}
          >
            {option.label}
          </Chip>
        );
      })}
    </ControlGroup>
  );
}

function DateTimeControl({
  control,
  value,
  onChange,
  path,
  errors,
  disabled,
}: Narrowed<'datetime'>): JSX.Element {
  const error = errorAt(errors, path);
  const type =
    control.precision === 'date'
      ? 'date'
      : control.precision === 'time'
        ? 'time'
        : 'datetime-local';
  return (
    <div className="flex flex-col gap-1">
      <Input
        type={type}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        aria-label="Date and time"
        aria-invalid={error ? true : undefined}
        {...(control.min !== null ? { min: control.min } : {})}
        {...(control.max !== null ? { max: control.max } : {})}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <Text token="body-small" tone="muted">
        Times are read in {control.timeZone}.
      </Text>
    </div>
  );
}

/** Upload state for one file control. */
interface UploadState {
  readonly name: string;
  readonly percent: number;
}

function FileControl({
  control,
  value,
  onChange,
  path,
  errors,
  disabled,
  uploadTarget,
}: Narrowed<'file'>): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<UploadState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const files: ElicitationFileAnswer[] = control.multiple
    ? (Array.isArray(value) ? value : []).filter(isFileAnswer)
    : isFileAnswer(value)
      ? [value]
      : [];

  const accept = control.accept.length > 0 ? control.accept.join(',') : undefined;
  const maxMb = Math.round(control.maxBytes / (1024 * 1024));

  const upload = useCallback(
    async (chosen: File): Promise<void> => {
      setFailure(null);
      // Refused before a byte leaves the machine, and said out loud — an over-limit file that
      // silently does nothing is the failure mode this check exists to prevent.
      if (control.accept.length > 0 && !control.accept.includes(chosen.type)) {
        setFailure('That file type is not accepted here.');
        return;
      }
      if (chosen.size > control.maxBytes) {
        setFailure(`That file is larger than the ${String(maxMb)} MB limit for this request.`);
        return;
      }
      if (!uploadTarget) {
        setFailure('This question has no workspace to store a file in.');
        return;
      }
      setUploading({ name: chosen.name, percent: 10 });
      try {
        setUploading({ name: chosen.name, percent: 55 });
        // The file rides as a real multipart part through the typed RPC client, and lands as a
        // durable task attachment — which is why a file answer survives a reload and why the agent
        // can read the bytes back through the same attachment route anything else uses.
        const response = await api.v1.orgs[':orgId'].tasks[':id'].attachments.upload.$post({
          param: { orgId: uploadTarget.orgId, id: uploadTarget.taskId },
          form: { file: chosen },
        });
        if (!response.ok) {
          setFailure('That file could not be uploaded. Try again.');
          return;
        }
        const attachment: {
          id: string;
          fileName: string | null;
          mimeType: string | null;
          byteSize: number | null;
        } = await response.json();
        setUploading({ name: chosen.name, percent: 100 });
        const answer: ElicitationFileAnswer = {
          attachmentId: attachment.id,
          fileName: attachment.fileName ?? chosen.name,
          contentType: attachment.mimeType ?? chosen.type,
          byteSize: attachment.byteSize ?? chosen.size,
        };
        onChange(control.multiple ? [...files, answer] : answer);
      } catch {
        setFailure('That file could not be uploaded. Try again.');
      } finally {
        setUploading(null);
      }
    },
    [control.accept, control.maxBytes, control.multiple, files, maxMb, onChange, uploadTarget],
  );

  const error = errorAt(errors, path) ?? failure;
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) void upload(dropped);
        }}
        className={cn(
          'border-outline-variant flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center',
          dragging && surfaceToneColor('floating'),
        )}
      >
        <Paperclip aria-hidden="true" className="text-on-surface-variant size-5" />
        <Text token="body-medium" tone="muted">
          Drop a file here, or choose one.
        </Text>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={accept}
          disabled={disabled === true || uploading !== null}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void upload(chosen);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          controlSize="lg"
          disabled={disabled === true || uploading !== null}
          onClick={() => inputRef.current?.click()}
        >
          Choose a file
        </Button>
        <Text token="label-small" tone="muted">
          {control.accept.length > 0 ? control.accept.join(', ') : 'Any file type'} · up to {maxMb}{' '}
          MB
        </Text>
      </div>

      {uploading ? (
        <div className="flex flex-col gap-1" aria-live="polite">
          <Text token="body-small" tone="muted">
            Uploading {uploading.name}…
          </Text>
          <progress
            className="h-1 w-full"
            value={uploading.percent}
            max={100}
            aria-label={`Uploading ${uploading.name}`}
          />
        </div>
      ) : null}

      {files.length > 0 ? (
        <ControlGroup controlSize="sm" wrap>
          {files.map((file) => (
            <Chip
              key={file.attachmentId}
              variant="input"
              icon={<Paperclip aria-hidden="true" />}
              removeLabel={`Remove ${file.fileName}`}
              onRemove={() => {
                onChange(
                  control.multiple
                    ? files.filter((entry) => entry.attachmentId !== file.attachmentId)
                    : null,
                );
              }}
            >
              {file.fileName}
            </Chip>
          ))}
        </ControlGroup>
      ) : null}

      {error ? (
        <Text token="body-small" tone="error" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

function isFileAnswer(value: unknown): value is ElicitationFileAnswer {
  return typeof value === 'object' && value !== null && 'attachmentId' in value;
}

function FormControl({
  control,
  value,
  onChange,
  path,
  errors,
  disabled,
  uploadTarget,
}: Narrowed<'form'>): JSX.Element {
  const record = (value ?? {}) as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-4">
      {control.fields.map((field) => {
        const childPath = path ? `${path}.${field.key}` : field.key;
        const error = errorAt(errors, childPath);
        return (
          <Field
            key={field.key}
            label={
              <span>
                {field.label}
                {field.required ? null : (
                  <Text token="label-small" tone="muted">
                    {' '}
                    (optional)
                  </Text>
                )}
              </span>
            }
            {...(field.description ? { description: field.description } : {})}
            {...(error ? { error } : {})}
          >
            <ElicitationControlView
              control={field.control}
              value={record[field.key]}
              path={childPath}
              errors={errors}
              {...(disabled === undefined ? {} : { disabled })}
              {...(uploadTarget ? { uploadTarget } : {})}
              onChange={(next) => {
                onChange({ ...record, [field.key]: next });
              }}
            />
          </Field>
        );
      })}
    </div>
  );
}

function ListControl({
  control,
  value,
  onChange,
  path,
  errors,
  disabled,
  uploadTarget,
}: Narrowed<'list'>): JSX.Element {
  const items: unknown[] = Array.isArray(value) ? value : [];
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <div key={`${path}-${String(index)}`} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ElicitationControlView
              control={control.item}
              value={item}
              path={`${path}.${String(index)}`}
              errors={errors}
              {...(disabled === undefined ? {} : { disabled })}
              {...(uploadTarget ? { uploadTarget } : {})}
              onChange={(next) => {
                onChange(items.map((entry, position) => (position === index ? next : entry)));
              }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            controlSize="lg"
            aria-label={`Remove item ${String(index + 1)}`}
            disabled={disabled}
            onClick={() => {
              onChange(items.filter((_entry, position) => position !== index));
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          controlSize="lg"
          disabled={disabled}
          onClick={() => {
            onChange([...items, emptyElicitationValue(control.item)]);
          }}
        >
          <Plus aria-hidden="true" />
          Add another
        </Button>
      </div>
    </div>
  );
}

function VariantControl({
  control,
  value,
  onChange,
  path,
  errors,
  disabled,
  uploadTarget,
}: Narrowed<'variant'>): JSX.Element {
  const groupId = useId();
  const record = (value ?? {}) as Record<string, unknown>;
  const tag = discriminatorOf(record, control.discriminator) || (control.variants[0]?.value ?? '');
  const active = control.variants.find((candidate) => candidate.value === tag);
  return (
    <div className="flex flex-col gap-4">
      <ControlGroup controlSize="lg" wrap role="group" aria-labelledby={groupId}>
        {control.variants.map((variant) => (
          <Chip
            key={variant.value}
            variant="filter"
            tone="outlined"
            icon={
              variant.value === tag ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />
            }
            selected={variant.value === tag}
            disabled={disabled}
            onClick={() => {
              const next: Record<string, unknown> = { [control.discriminator]: variant.value };
              for (const field of variant.fields) {
                next[field.key] = emptyElicitationValue(field.control);
              }
              onChange(next);
            }}
          >
            {variant.label}
          </Chip>
        ))}
      </ControlGroup>
      {active && active.fields.length > 0 ? (
        <FormControl
          control={{ kind: 'form', fields: active.fields }}
          value={record}
          path={path}
          errors={errors}
          {...(disabled === undefined ? {} : { disabled })}
          {...(uploadTarget ? { uploadTarget } : {})}
          onChange={(next) => {
            onChange({ ...(next as Record<string, unknown>), [control.discriminator]: tag });
          }}
        />
      ) : null}
    </div>
  );
}
