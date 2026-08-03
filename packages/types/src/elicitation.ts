/**
 * `@docket/types` — the elicitation contract: how Athena asks for structured data.
 *
 * @remarks
 * An elicitation is not a question, it is a *typed request for the one value Athena needs to
 * finish a piece of work she is doing on your behalf*. Three consequences follow, and all three
 * are encoded here rather than left to convention:
 *
 * 1. **The answer has a declared shape.** {@link ElicitationSpec} is a closed, recursive control
 *    grammar. {@link elicitationAnswerSchema} turns a spec into the Zod validator the server runs
 *    before anyone sees the answer, so an invalid submission is rejected with per-field errors and
 *    the elicitation stays open. The agent is then handed parsed typed data — never free text.
 * 2. **The card names the action.** {@link ElicitationRequest.actionSummary} is required, because a
 *    request to act on someone's behalf that does not say what it will do is not consent.
 * 3. **Anything Zod can express is askable.** {@link elicitationFromZod} walks a Zod schema into a
 *    spec and throws {@link UnsupportedElicitationSchemaError} on a kind it cannot render — a loud
 *    failure rather than a silently empty form. {@link elicitationFromMcpRequestedSchema} does the
 *    same for a spec-shaped MCP `elicitation/create` request, so a third-party MCP server's ask
 *    renders in Athena's own chrome.
 *
 * Validation messages here are Docket's own sentences, keyed off Zod issue *codes*. Library or
 * provider text is never surfaced: {@link elicitationFieldMessage} is the only source of copy.
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------------------------- */
/* The control grammar                                                                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * Every control kind an elicitation can be built from.
 *
 * @remarks
 * The first six are the response types the product promises (text, confirmation, selection,
 * date/time, file upload, structured form). `number`, `list` and `variant` exist because a Zod
 * schema can contain them and the promise is that anything expressible in Zod is askable; they
 * are never the *headline* of an elicitation on their own, but they are legal field controls.
 */
export const ELICITATION_CONTROL_KINDS = [
  'text',
  'confirm',
  'select',
  'datetime',
  'file',
  'form',
  'number',
  'list',
  'variant',
] as const;

/** One control kind from {@link ELICITATION_CONTROL_KINDS}. */
export type ElicitationControlKind = (typeof ELICITATION_CONTROL_KINDS)[number];

/** The six response types an elicitation may lead with, in the author's own vocabulary. */
export const ELICITATION_RESPONSE_KINDS = [
  'text',
  'confirm',
  'select',
  'datetime',
  'file',
  'form',
] as const;

/** A headline response type from {@link ELICITATION_RESPONSE_KINDS}. */
export type ElicitationResponseKind = (typeof ELICITATION_RESPONSE_KINDS)[number];

/** How precise a `datetime` control is, and therefore what the answer string means. */
export const ElicitationDateTimePrecision = z.enum(['date', 'time', 'datetime']);
/** A {@link ElicitationDateTimePrecision} value. */
export type ElicitationDateTimePrecision = z.infer<typeof ElicitationDateTimePrecision>;

/** One choice offered by a `select` control or one arm of a `variant`. */
export const ElicitationOption = z
  .object({
    /** The value returned to the agent when this option is chosen. */
    value: z.string().min(1),
    /** The label a person reads. */
    label: z.string().min(1),
    /** Optional one-line clarification shown under the label. */
    description: z.string().nullable().default(null),
  })
  .meta({ id: 'ElicitationOption', description: 'One predefined option in an elicitation.' });
/** An {@link ElicitationOption} value. */
export type ElicitationOption = z.infer<typeof ElicitationOption>;

/** A `text` control: one free-text answer, optionally constrained in length. */
export const ElicitationTextControl = z.object({
  kind: z.literal('text'),
  /** Render a multi-line textarea rather than a single-line input. */
  multiline: z.boolean().default(false),
  minLength: z.number().int().min(0).nullable().default(null),
  maxLength: z.number().int().min(1).nullable().default(null),
  placeholder: z.string().nullable().default(null),
});

/** A `number` control: one numeric answer with optional bounds and integrality. */
export const ElicitationNumberControl = z.object({
  kind: z.literal('number'),
  integer: z.boolean().default(false),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
});

/** A `confirm` control: a yes/no decision whose labels name both outcomes. */
export const ElicitationConfirmControl = z.object({
  kind: z.literal('confirm'),
  /** Label of the affirmative control; answering with it returns `true`. */
  confirmLabel: z.string().min(1).default('Confirm'),
  /** Label of the negative control; answering with it returns `false`. */
  declineLabel: z.string().min(1).default('Decline'),
});

/** A `select` control: one or more choices from a closed set. */
export const ElicitationSelectControl = z.object({
  kind: z.literal('select'),
  options: z.array(ElicitationOption).min(1),
  /** Allow more than one option; the answer is then an array of values. */
  multiple: z.boolean().default(false),
});

/** A `datetime` control: an instant, a calendar day, or a time of day. */
export const ElicitationDateTimeControl = z.object({
  kind: z.literal('datetime'),
  precision: ElicitationDateTimePrecision.default('datetime'),
  /**
   * The IANA zone the answer is interpreted in.
   *
   * @remarks
   * Carried on the control rather than assumed at read time so "3pm" means the same instant to
   * the person answering and to the agent acting, even when they are configured differently.
   */
  timeZone: z.string().min(1).default('UTC'),
  /** Inclusive earliest acceptable value, in the same lexical form as the answer. */
  min: z.string().nullable().default(null),
  /** Inclusive latest acceptable value, in the same lexical form as the answer. */
  max: z.string().nullable().default(null),
});

/** A `file` control: one or more uploaded files, answered as durable attachment references. */
export const ElicitationFileControl = z.object({
  kind: z.literal('file'),
  /** Accepted MIME types; empty means anything. */
  accept: z.array(z.string().min(1)).default([]),
  /** Per-file ceiling in bytes. */
  maxBytes: z
    .number()
    .int()
    .min(1)
    .default(25 * 1024 * 1024),
  multiple: z.boolean().default(false),
});

/** One named field inside a `form` or `variant` control. */
export interface ElicitationField {
  /** The object key this field's value lands on. */
  readonly key: string;
  /** The label a person reads. */
  readonly label: string;
  /** Optional supporting sentence. */
  readonly description: string | null;
  /** When false the field may be omitted and its value is `null`. */
  readonly required: boolean;
  /** The control rendered for this field. */
  readonly control: ElicitationControl;
}

/** A `form` control: several labeled fields answered as one object. */
export interface ElicitationFormControl {
  readonly kind: 'form';
  readonly fields: readonly ElicitationField[];
}

/** A `list` control: zero or more values of one shape, answered as an array. */
export interface ElicitationListControl {
  readonly kind: 'list';
  readonly item: ElicitationControl;
  readonly minItems: number | null;
  readonly maxItems: number | null;
}

/** One arm of a {@link ElicitationVariantControl}. */
export interface ElicitationVariant {
  /** The discriminator value this arm is selected by. */
  readonly value: string;
  /** The label a person reads in the arm picker. */
  readonly label: string;
  /** The fields that appear once this arm is selected. */
  readonly fields: readonly ElicitationField[];
}

/** A `variant` control: pick an arm, then fill that arm's fields (a discriminated union). */
export interface ElicitationVariantControl {
  readonly kind: 'variant';
  /** The object key carrying the chosen arm's value. */
  readonly discriminator: string;
  readonly variants: readonly ElicitationVariant[];
}

/** Any control an elicitation can be built from. */
export type ElicitationControl =
  | z.infer<typeof ElicitationTextControl>
  | z.infer<typeof ElicitationNumberControl>
  | z.infer<typeof ElicitationConfirmControl>
  | z.infer<typeof ElicitationSelectControl>
  | z.infer<typeof ElicitationDateTimeControl>
  | z.infer<typeof ElicitationFileControl>
  | ElicitationFormControl
  | ElicitationListControl
  | ElicitationVariantControl;

/**
 * The declared answer shape of one elicitation.
 *
 * @remarks
 * Structurally identical to {@link ElicitationControl}; the alias exists because the top-level
 * control is the thing the card is *about*, and reading `spec.kind === 'confirm'` at a call site
 * says more than reading `control.kind === 'confirm'`.
 */
export type ElicitationSpec = ElicitationControl;

const elicitationFieldSchema: z.ZodType<ElicitationField> = z.lazy(() =>
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().nullable().default(null),
    required: z.boolean().default(true),
    control: ElicitationControlSchema,
  }),
);

/**
 * The runtime validator for {@link ElicitationControl}.
 *
 * @remarks
 * Recursive via `z.lazy`, so a form field may itself be a form, a list, or a variant. This
 * validates the *declaration*; {@link elicitationAnswerSchema} builds the validator for the
 * answer that declaration describes.
 */
export const ElicitationControlSchema: z.ZodType<ElicitationControl> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    ElicitationTextControl,
    ElicitationNumberControl,
    ElicitationConfirmControl,
    ElicitationSelectControl,
    ElicitationDateTimeControl,
    ElicitationFileControl,
    z.object({ kind: z.literal('form'), fields: z.array(elicitationFieldSchema).min(1) }),
    z.object({
      kind: z.literal('list'),
      item: ElicitationControlSchema,
      minItems: z.number().int().min(0).nullable().default(null),
      maxItems: z.number().int().min(1).nullable().default(null),
    }),
    z.object({
      kind: z.literal('variant'),
      discriminator: z.string().min(1),
      variants: z
        .array(
          z.object({
            value: z.string().min(1),
            label: z.string().min(1),
            fields: z.array(elicitationFieldSchema),
          }),
        )
        .min(1),
    }),
  ]),
);

/** The declared answer shape of one elicitation; see {@link ElicitationSpec}. */
export const ElicitationSpecSchema: z.ZodType<ElicitationSpec> = ElicitationControlSchema;

/* -------------------------------------------------------------------------------------------- */
/* Lifecycle                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/** The lifecycle state of one elicitation. */
export const ElicitationStatus = z.enum([
  'pending',
  'answered',
  'auto_resolved',
  'parked',
  'canceled',
]);
/** An {@link ElicitationStatus} value. */
export type ElicitationStatus = z.infer<typeof ElicitationStatus>;

/** Every {@link ElicitationStatus} value, for iteration and DB CHECK generation. */
export const ELICITATION_STATUSES = ElicitationStatus.options;

/** Who (or what) settled an elicitation. */
export const ElicitationResolver = z.enum(['user', 'athena', 'timeout']);
/** An {@link ElicitationResolver} value. */
export type ElicitationResolver = z.infer<typeof ElicitationResolver>;

/** Every {@link ElicitationResolver} value, for iteration and DB CHECK generation. */
export const ELICITATION_RESOLVERS = ElicitationResolver.options;

/**
 * Whether a deadline may be answered by Athena instead of by the person.
 *
 * @remarks
 * The product rule is "choose an option itself *if it makes sense given the current context*",
 * which means the safe branch has to be nameable. `derivable` says the raising agent supplied a
 * defensible default and the reasoning for it. `ambiguous` says two answers are equally valid.
 * `destructive` says the action cannot be taken back. Only `derivable` auto-resolves; the other
 * two park the work and tell the person, which is why this is a required declaration rather than
 * an inferred property — an agent that forgets to think about it gets the safe behaviour.
 */
export const ElicitationTimeoutPolicy = z.enum(['derivable', 'ambiguous', 'destructive']);
/** An {@link ElicitationTimeoutPolicy} value. */
export type ElicitationTimeoutPolicy = z.infer<typeof ElicitationTimeoutPolicy>;

/** Every {@link ElicitationTimeoutPolicy} value, for iteration and DB CHECK generation. */
export const ELICITATION_TIMEOUT_POLICIES = ElicitationTimeoutPolicy.options;

/** The default window an elicitation waits before its timeout policy applies. */
export const ELICITATION_DEFAULT_TTL_MS = 30 * 60 * 1000;

/** The shortest window a caller may declare, so "live" still means answerable. */
export const ELICITATION_MIN_TTL_MS = 60 * 1000;

/** The longest window a caller may declare; nothing waits forever. */
export const ELICITATION_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------------------------- */
/* The request                                                                                   */
/* -------------------------------------------------------------------------------------------- */

/** Everything one raised elicitation declares about itself. */
export interface ElicitationRequest {
  /** The question, in the agent's own words. */
  readonly question: string;
  /**
   * The concrete action this answer authorizes, as a sentence a person can audit.
   *
   * @remarks
   * Required, and deliberately separate from `question`. "Which channel?" tells you nothing about
   * what happens next; "Post the sprint update to the Acme project channel" does.
   */
  readonly actionSummary: string;
  /** The declared answer shape. */
  readonly spec: ElicitationSpec;
  /** What happens at the deadline; see {@link ElicitationTimeoutPolicy}. */
  readonly timeoutPolicy: ElicitationTimeoutPolicy;
  /**
   * The answer Athena will record if nobody replies, valid against `spec`.
   *
   * @remarks
   * Only consulted when `timeoutPolicy` is `derivable`. Present-but-invalid is treated as absent,
   * because a default that does not parse is not a default.
   */
  readonly autoResolveValue: unknown;
  /** Why that default is defensible, stated in the transcript when it is used. */
  readonly autoResolveReason: string | null;
  /** Whether waiting has a cost — drives push notification and the live/absent branch. */
  readonly timeSensitive: boolean;
}

/** Validator for {@link ElicitationRequest} as raised by an agent tool call. */
export const ElicitationRequestSchema = z
  .object({
    question: z.string().min(1).max(2000),
    actionSummary: z.string().min(1).max(2000),
    spec: ElicitationSpecSchema,
    timeoutPolicy: ElicitationTimeoutPolicy.default('ambiguous'),
    autoResolveValue: z.unknown().default(null),
    autoResolveReason: z.string().max(2000).nullable().default(null),
    timeSensitive: z.boolean().default(false),
  })
  .meta({
    id: 'ElicitationRequest',
    description: 'A typed request for the one value an agent needs to finish a piece of work.',
  });

/* -------------------------------------------------------------------------------------------- */
/* Answer validation                                                                             */
/* -------------------------------------------------------------------------------------------- */

/**
 * One rejected field of a submitted answer.
 *
 * @remarks
 * The sentence is deliberately NOT called `message`: the web workspace's error-source policy
 * forbids reading a `.message` property in production UI, precisely because that is how exception
 * and provider text leaks onto a screen. Naming it `text` keeps the field readable and keeps the
 * policy's signal meaningful — nothing here is ever an exception's own words.
 */
export interface ElicitationFieldError {
  /** Dotted path to the offending value; `''` for the answer as a whole. */
  readonly path: string;
  /** Docket's own sentence explaining what to change. Never library or provider text. */
  readonly text: string;
}

/** The outcome of validating a submitted answer against its declared spec. */
export type ElicitationParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly errors: readonly ElicitationFieldError[] };

/** Thrown when a schema contains a construct no elicitation control can render. */
export class UnsupportedElicitationSchemaError extends Error {
  /** The offending schema's own type tag, for the operator reading the log. */
  readonly schemaType: string;
  /** Dotted path to the offending node inside the schema being converted. */
  readonly path: string;

  /**
   * @param schemaType - The schema type tag that has no control.
   * @param path - Dotted path to the offending node.
   */
  constructor(schemaType: string, path: string) {
    super(
      `No elicitation control can represent a "${schemaType}" schema` +
        (path ? ` at "${path}"` : ''),
    );
    this.name = 'UnsupportedElicitationSchemaError';
    this.schemaType = schemaType;
    this.path = path;
  }
}

/** ISO-8601 calendar day, e.g. `2026-08-02`. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** 24-hour clock time, e.g. `14:05` or `14:05:30`. */
const TIME_ONLY = /^\d{2}:\d{2}(:\d{2})?$/;

function datetimePattern(precision: ElicitationDateTimePrecision): RegExp {
  if (precision === 'date') return DATE_ONLY;
  if (precision === 'time') return TIME_ONLY;
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
}

/** A durable reference to a file supplied as an elicitation answer. */
export const ElicitationFileAnswer = z
  .object({
    /** The Docket attachment id the agent reads the bytes through. */
    attachmentId: z.string().min(1),
    /** The uploaded file's own name, for display. */
    fileName: z.string().min(1),
    /** MIME type as uploaded. */
    contentType: z.string().min(1),
    /** Size in bytes as stored. */
    byteSize: z.number().int().min(0),
  })
  .meta({
    id: 'ElicitationFileAnswer',
    description: 'A durable reference to a file supplied as an elicitation answer.',
  });
/** An {@link ElicitationFileAnswer} value. */
export type ElicitationFileAnswer = z.infer<typeof ElicitationFileAnswer>;

function textAnswerSchema(control: z.infer<typeof ElicitationTextControl>): z.ZodType {
  let schema = z.string();
  if (control.minLength !== null) schema = schema.min(control.minLength);
  if (control.maxLength !== null) schema = schema.max(control.maxLength);
  return schema;
}

function numberAnswerSchema(control: z.infer<typeof ElicitationNumberControl>): z.ZodType {
  let schema = control.integer ? z.number().int() : z.number();
  if (control.min !== null) schema = schema.min(control.min);
  if (control.max !== null) schema = schema.max(control.max);
  return schema;
}

function selectAnswerSchema(control: z.infer<typeof ElicitationSelectControl>): z.ZodType {
  const values = control.options.map((option) => option.value);
  const one = z.string().refine((value) => values.includes(value), { error: 'not_an_option' });
  return control.multiple ? z.array(one).min(1) : one;
}

function datetimeAnswerSchema(control: z.infer<typeof ElicitationDateTimeControl>): z.ZodType {
  const pattern = datetimePattern(control.precision);
  return z
    .string()
    .regex(pattern, { error: 'bad_datetime' })
    .refine((value) => control.min === null || value >= control.min, {
      error: 'datetime_too_early',
    })
    .refine((value) => control.max === null || value <= control.max, {
      error: 'datetime_too_late',
    });
}

function fileAnswerSchema(control: z.infer<typeof ElicitationFileControl>): z.ZodType {
  const one = ElicitationFileAnswer.refine(
    (file) => control.accept.length === 0 || control.accept.includes(file.contentType),
    { error: 'file_type_rejected' },
  ).refine((file) => file.byteSize <= control.maxBytes, { error: 'file_too_large' });
  return control.multiple ? z.array(one).min(1) : one;
}

function fieldsAnswerSchema(fields: readonly ElicitationField[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const inner = elicitationAnswerSchema(field.control);
    shape[field.key] = field.required ? inner : inner.nullable().optional();
  }
  return z.object(shape);
}

/**
 * Build the Zod validator for the answer one control accepts.
 *
 * @remarks
 * This is the single source of truth for what a valid answer is. The API validates submissions
 * with it, the schema-driven renderer reads the same spec to draw controls, and the agent receives
 * `parse`'s output — so "what the form allowed" and "what the server accepted" cannot drift.
 *
 * @param spec - The declared control.
 * @returns A Zod schema whose output is the typed answer.
 *
 * @example
 * ```typescript
 * const schema = elicitationAnswerSchema({ kind: 'confirm', confirmLabel: 'Send', declineLabel: 'Cancel' });
 * schema.parse(true); // true
 * ```
 */
export function elicitationAnswerSchema(spec: ElicitationSpec): z.ZodType {
  switch (spec.kind) {
    case 'text':
      return textAnswerSchema(spec);
    case 'number':
      return numberAnswerSchema(spec);
    case 'confirm':
      return z.boolean();
    case 'select':
      return selectAnswerSchema(spec);
    case 'datetime':
      return datetimeAnswerSchema(spec);
    case 'file':
      return fileAnswerSchema(spec);
    case 'form':
      return fieldsAnswerSchema(spec.fields);
    case 'list': {
      let schema = z.array(elicitationAnswerSchema(spec.item));
      if (spec.minItems !== null) schema = schema.min(spec.minItems);
      if (spec.maxItems !== null) schema = schema.max(spec.maxItems);
      return schema;
    }
    case 'variant': {
      const arms: z.ZodType[] = spec.variants.map((variant) =>
        z.object({
          [spec.discriminator]: z.literal(variant.value),
          ...variantShape(variant.fields),
        }),
      );
      const [first, second, ...rest] = arms;
      /* v8 ignore next -- @preserve declaration validation guarantees at least one arm */
      if (!first) return z.never();
      if (!second) return first;
      return z.union([first, second, ...rest]);
    }
  }
}

function variantShape(fields: readonly ElicitationField[]): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const inner = elicitationAnswerSchema(field.control);
    shape[field.key] = field.required ? inner : inner.nullable().optional();
  }
  return shape;
}

/**
 * Docket's own sentence for one Zod issue.
 *
 * @remarks
 * Branching on the issue's stable `code` (and on the `error` tags this module attaches) rather
 * than surfacing Zod's English keeps validation copy application-owned, which is the repo's
 * error-copy rule. An unrecognised code gets a neutral sentence rather than the library's.
 *
 * @param issue - One Zod issue from a failed parse.
 * @returns A sentence to show under the offending field.
 */
export function elicitationFieldMessage(issue: z.core.$ZodIssue): string {
  const tag = typeof issue.message === 'string' ? issue.message : '';
  switch (tag) {
    case 'not_an_option':
      return 'Choose one of the options offered.';
    case 'bad_datetime':
      return 'Enter a complete date and time.';
    case 'datetime_too_early':
      return 'Pick a later date and time.';
    case 'datetime_too_late':
      return 'Pick an earlier date and time.';
    case 'file_type_rejected':
      return 'That file type is not accepted here.';
    case 'file_too_large':
      return 'That file is larger than this request allows.';
    default:
      break;
  }
  switch (issue.code) {
    case 'invalid_type':
      return 'This answer is the wrong kind of value.';
    case 'too_small':
      return 'This answer is too short.';
    case 'too_big':
      return 'This answer is too long.';
    case 'invalid_format':
      return 'This answer is not in the expected format.';
    case 'invalid_value':
      return 'Choose one of the options offered.';
    case 'unrecognized_keys':
      return 'This answer includes something that was not asked for.';
    case 'invalid_union':
      return 'This answer does not match any of the accepted shapes.';
    default:
      return 'This answer could not be accepted.';
  }
}

/**
 * Validate a submitted answer against its declared spec.
 *
 * @remarks
 * Never throws: a rejection is data, because the caller has to keep the elicitation open and
 * re-render the form with the person's typed values still in it.
 *
 * @param spec - The declared control the answer must satisfy.
 * @param raw - The submitted value, straight off the wire.
 * @returns The parsed typed value, or the per-field reasons it was refused.
 */
export function parseElicitationAnswer(
  spec: ElicitationSpec,
  raw: unknown,
): ElicitationParseResult {
  const result = elicitationAnswerSchema(spec).safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    text: elicitationFieldMessage(issue),
  }));
  return { ok: false, errors };
}

/* -------------------------------------------------------------------------------------------- */
/* Zod → spec                                                                                    */
/* -------------------------------------------------------------------------------------------- */

interface ZodInternals {
  readonly _zod: { readonly def: Record<string, unknown> };
}

function defOf(schema: unknown): Record<string, unknown> {
  const internals = schema as ZodInternals;
  return internals._zod.def;
}

function checksOf(def: Record<string, unknown>): readonly Record<string, unknown>[] {
  const checks = def['checks'];
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => defOf(check));
}

function numericCheck(
  def: Record<string, unknown>,
  name: 'greater_than' | 'less_than',
): number | null {
  for (const check of checksOf(def)) {
    if (check['check'] === name && typeof check['value'] === 'number') return check['value'];
  }
  return null;
}

function lengthCheck(
  def: Record<string, unknown>,
  name: 'min_length' | 'max_length',
  key: 'minimum' | 'maximum',
): number | null {
  for (const check of checksOf(def)) {
    const value = check[key];
    if (check['check'] === name && typeof value === 'number') return value;
  }
  return null;
}

function isInteger(def: Record<string, unknown>): boolean {
  return checksOf(def).some(
    (check) =>
      check['check'] === 'number_format' &&
      typeof check['format'] === 'string' &&
      check['format'].includes('int'),
  );
}

function titleize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (spaced.length === 0) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function literalValue(def: Record<string, unknown>): string | null {
  const values: unknown = def['values'];
  if (!Array.isArray(values) || values.length !== 1) return null;
  const value: unknown = values[0];
  return typeof value === 'string' ? value : null;
}

interface ConvertedField {
  readonly control: ElicitationControl;
  readonly required: boolean;
}

function convert(schema: unknown, path: string): ConvertedField {
  const def = defOf(schema);
  const type = String(def['type']);
  switch (type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'nonoptional':
    case 'readonly': {
      const inner = convert(def['innerType'], path);
      const required = type === 'nonoptional' || type === 'readonly' ? inner.required : false;
      return { control: inner.control, required };
    }
    case 'pipe':
      /* v8 ignore next -- defensive: a real Zod `pipe` def always populates `out`; `in` is an unreachable fallback */
      return convert(def['out'] ?? def['in'], path);
    case 'string': {
      const min = lengthCheck(def, 'min_length', 'minimum');
      const max = lengthCheck(def, 'max_length', 'maximum');
      return {
        control: {
          kind: 'text',
          multiline: false,
          minLength: min,
          maxLength: max,
          placeholder: null,
        },
        required: true,
      };
    }
    case 'number':
    case 'int':
      return {
        control: {
          kind: 'number',
          integer: type === 'int' || isInteger(def),
          min: numericCheck(def, 'greater_than'),
          max: numericCheck(def, 'less_than'),
        },
        required: true,
      };
    case 'boolean':
      return {
        control: { kind: 'confirm', confirmLabel: 'Yes', declineLabel: 'No' },
        required: true,
      };
    case 'date':
      return {
        control: {
          kind: 'datetime',
          precision: 'datetime',
          timeZone: 'UTC',
          min: null,
          max: null,
        },
        required: true,
      };
    case 'enum': {
      const entries = def['entries'];
      /* v8 ignore start -- defensive: Zod always populates `.entries` as an object for a real `enum` def */
      const values =
        entries && typeof entries === 'object'
          ? Object.values(entries as Record<string, unknown>).filter(
              (value): value is string => typeof value === 'string',
            )
          : [];
      /* v8 ignore stop */
      if (values.length === 0) throw new UnsupportedElicitationSchemaError('empty enum', path);
      return {
        control: {
          kind: 'select',
          options: values.map((value) => ({ value, label: titleize(value), description: null })),
          multiple: false,
        },
        required: true,
      };
    }
    case 'literal': {
      const value = literalValue(def);
      if (value === null) throw new UnsupportedElicitationSchemaError('non-string literal', path);
      return {
        control: {
          kind: 'select',
          options: [{ value, label: titleize(value), description: null }],
          multiple: false,
        },
        required: true,
      };
    }
    case 'array': {
      const item = convert(def['element'], `${path}[]`);
      return {
        control: {
          kind: 'list',
          item: item.control,
          minItems: lengthCheck(def, 'min_length', 'minimum'),
          maxItems: lengthCheck(def, 'max_length', 'maximum'),
        },
        required: true,
      };
    }
    case 'object': {
      /* v8 ignore next -- defensive: a real Zod `object` def always populates `shape` */
      const shape = (def['shape'] ?? {}) as Record<string, unknown>;
      const fields = Object.entries(shape).map(([key, value]) =>
        fieldOf(key, value, path ? `${path}.${key}` : key),
      );
      if (fields.length === 0) throw new UnsupportedElicitationSchemaError('empty object', path);
      return { control: { kind: 'form', fields }, required: true };
    }
    case 'union': {
      const discriminator = def['discriminator'];
      /* v8 ignore next -- defensive: a real Zod `discriminatedUnion` def always populates `options` */
      const options = (def['options'] ?? []) as readonly unknown[];
      if (typeof discriminator !== 'string' || options.length === 0) {
        throw new UnsupportedElicitationSchemaError('non-discriminated union', path);
      }
      const variants = options.map((option, index) => {
        const optionDef = defOf(option);
        /* v8 ignore next -- defensive: each discriminatedUnion arm is a real Zod `object` def, which always populates `shape` */
        const shape = (optionDef['shape'] ?? {}) as Record<string, unknown>;
        const tag = literalValue(defOf(shape[discriminator]));
        if (tag === null) {
          throw new UnsupportedElicitationSchemaError(
            'union arm without a string discriminator',
            `${path}[${index}]`,
          );
        }
        return {
          value: tag,
          label: titleize(tag),
          fields: Object.entries(shape)
            .filter(([key]) => key !== discriminator)
            .map(([key, value]) => fieldOf(key, value, `${path}.${tag}.${key}`)),
        };
      });
      return { control: { kind: 'variant', discriminator, variants }, required: true };
    }
    default:
      throw new UnsupportedElicitationSchemaError(type, path);
  }
}

function fieldOf(key: string, schema: unknown, path: string): ElicitationField {
  const converted = convert(schema, path);
  return {
    key,
    label: titleize(key),
    description: null,
    required: converted.required,
    control: converted.control,
  };
}

/**
 * Convert any supported Zod schema into an elicitation spec.
 *
 * @remarks
 * This is what makes "if it can be stuffed into Zod, it can be asked" true rather than aspirational.
 * Objects become forms, discriminated unions become variant pickers, arrays become lists, enums and
 * single string literals become selects, `optional`/`nullable`/`default` mark the field not-required
 * and unwrap. `refine`/`superRefine` are transparent — they hang off the underlying type, so a
 * refined object still converts, and the refinement is re-applied wherever the original schema is
 * parsed.
 *
 * A schema kind with no control — a function, a map, a set, a promise, a bare union — raises
 * {@link UnsupportedElicitationSchemaError} naming the kind and its path. Rendering half a form is
 * worse than refusing: the person cannot tell that a field is missing.
 *
 * @param schema - Any Zod schema describing the answer.
 * @returns The spec that renders and validates it.
 * @throws {UnsupportedElicitationSchemaError} When the schema contains an unrenderable construct.
 *
 * @example
 * ```typescript
 * const spec = elicitationFromZod(z.object({ channel: z.enum(['acme', 'ops']), note: z.string().optional() }));
 * // spec.kind === 'form' with a select and an optional text field
 * ```
 */
export function elicitationFromZod(schema: z.ZodType): ElicitationSpec {
  return convert(schema, '').control;
}

/* -------------------------------------------------------------------------------------------- */
/* MCP interop                                                                                   */
/* -------------------------------------------------------------------------------------------- */

/**
 * The three responses the MCP elicitation spec defines for `elicitation/create`.
 *
 * @remarks
 * `accept` carries content, `decline` is an explicit "no" from the person, `cancel` is a dismissal
 * that answers nothing. They are distinct on purpose: a server must be able to tell "the user said
 * no" from "the user closed the dialog".
 */
export const McpElicitAction = z.enum(['accept', 'decline', 'cancel']);
/** An {@link McpElicitAction} value. */
export type McpElicitAction = z.infer<typeof McpElicitAction>;

/** A spec-conformant `elicitation/create` result. */
export interface McpElicitResult {
  readonly action: McpElicitAction;
  readonly content?: Record<string, unknown>;
}

/**
 * Convert an MCP `requestedSchema` into an elicitation spec.
 *
 * @remarks
 * The MCP spec restricts elicitation to a flat object of primitives — string (with optional
 * `enum`/`enumNames`, `format`, `minLength`/`maxLength`), number/integer (`minimum`/`maximum`),
 * and boolean — which is a strict subset of this grammar, so a spec-shaped request always lands on
 * a `form`. `required` on the JSON Schema drives each field's `required`, and `title`/`description`
 * become the field's own copy so the third-party server's words reach the person unchanged.
 *
 * @param schema - The `requestedSchema` object from an `elicitation/create` request.
 * @returns The spec Athena renders the request with.
 * @throws {UnsupportedElicitationSchemaError} When a property declares a type with no control.
 *
 * @example
 * ```typescript
 * const spec = elicitationFromMcpRequestedSchema({
 *   type: 'object',
 *   properties: { confirmed: { type: 'boolean', title: 'Proceed?' } },
 *   required: ['confirmed'],
 * });
 * ```
 */
export function elicitationFromMcpRequestedSchema(schema: unknown): ElicitationSpec {
  const root = schema && typeof schema === 'object' ? (schema as Record<string, unknown>) : {};
  const properties =
    root['properties'] && typeof root['properties'] === 'object'
      ? (root['properties'] as Record<string, unknown>)
      : {};
  const required = Array.isArray(root['required'])
    ? new Set(root['required'].map((value) => String(value)))
    : new Set<string>();
  const entries = Object.entries(properties);
  if (entries.length === 0) throw new UnsupportedElicitationSchemaError('empty object', '');
  const fields = entries.map(([key, raw]) => {
    const property = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const description =
      typeof property['description'] === 'string' ? property['description'] : null;
    return {
      key,
      label: typeof property['title'] === 'string' ? property['title'] : titleize(key),
      description,
      required: required.has(key),
      control: mcpPropertyControl(property, key),
    };
  });
  return { kind: 'form', fields };
}

function mcpPropertyControl(property: Record<string, unknown>, path: string): ElicitationControl {
  const type = typeof property['type'] === 'string' ? property['type'] : '';
  if (type === 'boolean') {
    return { kind: 'confirm', confirmLabel: 'Yes', declineLabel: 'No' };
  }
  if (type === 'number' || type === 'integer') {
    return {
      kind: 'number',
      integer: type === 'integer',
      min: typeof property['minimum'] === 'number' ? property['minimum'] : null,
      max: typeof property['maximum'] === 'number' ? property['maximum'] : null,
    };
  }
  if (type !== 'string') throw new UnsupportedElicitationSchemaError(type || 'unknown', path);

  const values = Array.isArray(property['enum'])
    ? property['enum'].filter((value): value is string => typeof value === 'string')
    : [];
  if (values.length > 0) {
    const names = Array.isArray(property['enumNames']) ? property['enumNames'] : [];
    return {
      kind: 'select',
      options: values.map((value, index) => ({
        value,
        label: typeof names[index] === 'string' ? names[index] : titleize(value),
        description: null,
      })),
      multiple: false,
    };
  }
  const format = typeof property['format'] === 'string' ? property['format'] : '';
  if (format === 'date' || format === 'date-time') {
    return {
      kind: 'datetime',
      precision: format === 'date' ? 'date' : 'datetime',
      timeZone: 'UTC',
      min: null,
      max: null,
    };
  }
  return {
    kind: 'text',
    multiline: false,
    minLength: typeof property['minLength'] === 'number' ? property['minLength'] : null,
    maxLength: typeof property['maxLength'] === 'number' ? property['maxLength'] : null,
    placeholder: null,
  };
}

/**
 * Build the spec-conformant result for one settled MCP elicitation.
 *
 * @param action - Which of the three spec responses this is.
 * @param value - The accepted answer; ignored unless `action` is `accept`.
 * @returns The `elicitation/create` result to send back to the requesting server.
 */
export function toMcpElicitResult(action: McpElicitAction, value: unknown): McpElicitResult {
  if (action !== 'accept') return { action };
  const content =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  return { action, content };
}
